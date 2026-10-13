import sqlite3

from openpyxl import Workbook
from access_parser import AccessParser

EXCEL_MAX_ROWS = 1_048_576

PEX_SUMMARY_REQUIRED_TABLES = {
    "RISName",
    "Exam",
    "Exam_OGP",
    "OGP",
    "RAD_OGP",
    "OGP_kV",
    "OGP_mAs",
    "OGP_ms",
    "Technique",
    "Dose_RAD",
    "AcquisitionSystem",
    "StandPosition",
    "BodyPart",
    "Focus",
    "FilterType",
    "EXI_Parameter",
    "GradationParameter",
    "SpatialFrequencyParameter",
}


def safe_value(value):
    if isinstance(value, bytes):
        return "0x" + value.hex().upper()
    return value


def safe_sheet_name(name):
    for ch in '[]:*?/\\':
        name = name.replace(ch, "_")
    return name[:31] or "Tabell"


def unique_sheet_name(name, used):
    base = safe_sheet_name(name)
    candidate = base
    n = 2
    while candidate in used:
        suffix = f"_{n}"
        candidate = base[:31-len(suffix)] + suffix
        n += 1
    used.add(candidate)
    return candidate


def sqlite_connect_ro(path):
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def sqlite_tables(conn):
    return [
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
    ]


def is_pex_sqlite(tables):
    return PEX_SUMMARY_REQUIRED_TABLES.issubset(set(tables))


def detect_database(path, ext):
    ext = ext.lower()

    if ext in {".db3", ".sqlite", ".sqlite3"}:
        try:
            with sqlite_connect_ro(path) as conn:
                tables = sqlite_tables(conn)
            pex = is_pex_sqlite(tables)
            return {
                "kind": "sqlite",
                "label": "PEX / SQLite" if pex else "SQLite / DB3",
                "tables": len(tables),
                "processed": pex,
            }
        except Exception:
            pass

    if ext in {".mdb", ".accdb"}:
        try:
            db = AccessParser(path)
            tables = [name for name in db.catalog if not name.startswith("MSys")]
            return {
                "kind": "access",
                "label": "Access / PEX",
                "tables": len(tables),
                "processed": False,
            }
        except Exception:
            pass

    try:
        with sqlite_connect_ro(path) as conn:
            tables = sqlite_tables(conn)
        pex = is_pex_sqlite(tables)
        return {
            "kind": "sqlite",
            "label": "PEX / SQLite" if pex else "SQLite / DB3",
            "tables": len(tables),
            "processed": pex,
        }
    except Exception:
        pass

    try:
        db = AccessParser(path)
        tables = [name for name in db.catalog if not name.startswith("MSys")]
        return {
            "kind": "access",
            "label": "Access / PEX",
            "tables": len(tables),
            "processed": False,
        }
    except Exception as exc:
        raise ValueError("Databasformatet kunde inte identifieras eller läsas.") from exc


def scaled(value, divisor):
    if value is None:
        return None
    result = value / divisor
    if isinstance(result, float) and result.is_integer():
        return int(result)
    return result


def exposure_values(technique, raw_mas, raw_ms):
    """Translate PEX radiography lookup values to readable exposure values.

    2 pt stores a direct mAs selection in OGP_mAs (hundredths of mAs).
    3 pt stores mA in OGP_mAs (hundredths of mA) and exposure time in
    OGP_ms (tenths of a millisecond). mAs is then calculated from mA * s.
    1 pt is the normal AEC mode and normally has no fixed manual values.
    """
    technique = (technique or "").strip()
    ma = None
    time_s = None
    mas = None

    if technique == "2 pt":
        mas = scaled(raw_mas, 100)
    elif technique.startswith("3 pt"):
        ma = scaled(raw_mas, 100)
        time_s = scaled(raw_ms, 10_000)
        if ma is not None and time_s is not None:
            mas = ma * time_s
            if isinstance(mas, float):
                mas = round(mas, 4)
    elif raw_mas is not None and raw_ms is None:
        mas = scaled(raw_mas, 100)

    return ma, time_s, mas


def export_pex_summary(conn, wb, used):
    headers = [
        "RISName",
        "Undersökning",
        "Protokoll / projektion",
        "Ordning",
        "Acquisition system",
        "Stativ",
        "Kroppsdel",
        "Teknik",
        "AEC standard",
        "Dos (µGy)",
        "kV",
        "mA",
        "Tid (s)",
        "mAs",
        "Fokus",
        "Filter",
        "Sensitivitet",
        "Target EXI",
        "Gradation",
        "Contrast",
        "Spatial frequency",
        "Edge gain",
        "Harmonis gain",
        "Noise reduction",
        "Amplification",
        "OGP-ID",
    ]

    query = """
        SELECT
            r.Name AS ris_name,
            e.Name AS exam_name,
            o.Name AS protocol_name,
            eo.orderOGP AS protocol_order,
            acq.Name AS acquisition_system,
            sp.Name AS stand_position,
            bp.Name AS body_part,
            tech.Value AS technique,
            dose.Dose AS dose,
            kv.Value AS kv_raw,
            mas.Value AS mas_raw,
            ms.Value AS ms_raw,
            f.Name AS focus,
            ft.Name AS filter_value,
            dose.Sensitivity AS sensitivity,
            exi.TargetEXI AS target_exi,
            grad.Name AS gradation,
            grad.Contrast AS contrast,
            sf.Name AS spatial_frequency,
            sf.EdgeFilterGain AS edge_gain,
            sf.HarmonisGain AS harmonis_gain,
            sf.NoiseReduction AS noise_reduction,
            ro.ImageAmplification AS amplification,
            o.ID AS ogp_id
        FROM Exam_OGP eo
        JOIN Exam e ON e.ID = eo.id_exam
        JOIN RISName r ON r.ID = e.ID_RISName
        JOIN OGP o ON o.ID = eo.id_ogp
        JOIN RAD_OGP ro ON ro.ID = o.ID
        LEFT JOIN AcquisitionSystem acq ON acq.ID = o.ID_AcqSystem
        LEFT JOIN StandPosition sp ON sp.ID = o.ID_StandPosition
        LEFT JOIN BodyPart bp ON bp.ID = o.ID_BodyPart
        LEFT JOIN Technique tech ON tech.ID = ro.ID_Technique
        LEFT JOIN Dose_RAD dose ON dose.ID = ro.ID_Dose
        LEFT JOIN OGP_kV kv ON kv.ID = o.ID_kV
        LEFT JOIN OGP_mAs mas ON mas.ID = ro.ID_mAs
        LEFT JOIN OGP_ms ms ON ms.ID = ro.ID_ms
        LEFT JOIN Focus f ON f.ID = o.ID_Focus
        LEFT JOIN FilterType ft ON ft.ID = o.ID_FilterType
        LEFT JOIN EXI_Parameter exi ON exi.ID = ro.ID_EXI_Parameter
        LEFT JOIN GradationParameter grad ON grad.IDs = ro.ID_ImageGradation
        LEFT JOIN SpatialFrequencyParameter sf ON sf.ID = o.ID_ImaSpatialFreqParam
        WHERE r.Name IS NOT NULL
          AND TRIM(r.Name) <> ''
        ORDER BY r.Name COLLATE NOCASE, e.Name COLLATE NOCASE, eo.orderOGP, o.ID
    """

    ws = wb.create_sheet(unique_sheet_name("Undersökningar", used))
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:Z1"
    ws.append(headers)

    # Reasonable widths for the human-readable sheet. Raw sheets remain unchanged.
    widths = {
        "A": 24, "B": 28, "C": 38, "D": 9, "E": 20, "F": 22, "G": 16,
        "H": 14, "I": 13, "J": 12, "K": 10, "L": 10, "M": 11, "N": 10,
        "O": 9, "P": 9, "Q": 12, "R": 12, "S": 20, "T": 11, "U": 24,
        "V": 11, "W": 13, "X": 16, "Y": 14, "Z": 10,
    }
    for column, width in widths.items():
        ws.column_dimensions[column].width = width

    count = 0
    for row in conn.execute(query):
        (
            ris_name,
            exam_name,
            protocol_name,
            protocol_order,
            acquisition_system,
            stand_position,
            body_part,
            technique,
            dose,
            kv_raw,
            mas_raw,
            ms_raw,
            focus,
            filter_value,
            sensitivity,
            target_exi,
            gradation,
            contrast,
            spatial_frequency,
            edge_gain,
            harmonis_gain,
            noise_reduction,
            amplification,
            ogp_id,
        ) = row

        # Separator rows such as "---" are menu dividers, not exposure protocols.
        if not (protocol_name or "").replace("-", "").strip():
            continue

        ma, time_s, mas = exposure_values(technique, mas_raw, ms_raw)
        if technique:
            aec_standard = "Ja" if technique == "1 pt" or "aec" in technique.lower() else "Nej"
        else:
            aec_standard = None

        ws.append([
            ris_name,
            exam_name,
            protocol_name,
            protocol_order,
            acquisition_system,
            stand_position,
            body_part,
            technique,
            aec_standard,
            dose,
            scaled(kv_raw, 10),
            ma,
            time_s,
            mas,
            focus,
            filter_value,
            sensitivity,
            target_exi,
            gradation,
            contrast,
            spatial_frequency,
            edge_gain,
            harmonis_gain,
            "På" if noise_reduction else "Av" if noise_reduction is not None else None,
            amplification,
            ogp_id,
        ])
        count += 1

    return count


def export_sqlite(input_path, output_path, progress):
    with sqlite_connect_ro(input_path) as conn:
        tables = sqlite_tables(conn)

        wb = Workbook(write_only=True)
        used = set()
        total = len(tables)
        last_table = ""
        last_rows = 0
        processed_rows = 0

        if is_pex_sqlite(tables):
            processed_rows = export_pex_summary(conn, wb, used)

        for index, table in enumerate(tables, start=1):
            last_table = table
            rows_written = 0
            safe_table = table.replace('"', '""')
            cur = conn.execute(f'SELECT * FROM "{safe_table}"')
            columns = [d[0] for d in cur.description]

            sheet_number = 1
            ws = wb.create_sheet(unique_sheet_name(table, used))
            ws.append(columns)
            rows_in_sheet = 1

            while True:
                batch = cur.fetchmany(5000)
                if not batch:
                    break
                for row in batch:
                    if rows_in_sheet >= EXCEL_MAX_ROWS:
                        sheet_number += 1
                        ws = wb.create_sheet(unique_sheet_name(f"{table}_{sheet_number}", used))
                        ws.append(columns)
                        rows_in_sheet = 1
                    ws.append([safe_value(v) for v in row])
                    rows_in_sheet += 1
                    rows_written += 1
                progress(index, total, table, rows_written)

            last_rows = rows_written
            progress(index, total, table, rows_written)

        wb.save(output_path)
        return {
            "tables": total,
            "last_table": last_table,
            "last_rows": last_rows,
            "processed_rows": processed_rows,
            "processed_sheet": "Undersökningar" if processed_rows else None,
        }


def export_access(input_path, output_path, progress):
    db = AccessParser(input_path)
    tables = [name for name in db.catalog if not name.startswith("MSys")]

    wb = Workbook(write_only=True)
    used = set()
    total = len(tables)
    last_table = ""
    last_rows = 0

    for index, table_name in enumerate(tables, start=1):
        last_table = table_name
        table = db.parse_table(table_name)
        columns = list(table.keys())
        row_count = len(table[columns[0]]) if columns else 0

        sheet_number = 1
        ws = wb.create_sheet(unique_sheet_name(table_name, used))
        ws.append(columns)
        rows_in_sheet = 1

        for row_index in range(row_count):
            if rows_in_sheet >= EXCEL_MAX_ROWS:
                sheet_number += 1
                ws = wb.create_sheet(unique_sheet_name(f"{table_name}_{sheet_number}", used))
                ws.append(columns)
                rows_in_sheet = 1

            ws.append([safe_value(table[col][row_index]) for col in columns])
            rows_in_sheet += 1

            if row_index and row_index % 5000 == 0:
                progress(index, total, table_name, row_index + 1)

        last_rows = row_count
        progress(index, total, table_name, row_count)

    wb.save(output_path)
    return {
        "tables": total,
        "last_table": last_table,
        "last_rows": last_rows,
        "processed_rows": 0,
        "processed_sheet": None,
    }


def export_database(input_path, output_path, kind, progress):
    if kind == "sqlite":
        return export_sqlite(input_path, output_path, progress)
    if kind == "access":
        return export_access(input_path, output_path, progress)
    raise ValueError(f"Okänd databastyp: {kind}")
