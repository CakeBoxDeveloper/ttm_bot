"""
Generate schedule.xlsx — booking table for TTM Massage Bot.

Structure:
  Row 1  — header: Date | 09:00 | 10:00 | ... | 21:00
  Row 2+ — one row per day from 2025-01-01 to 2027-12-31
  Cell value: empty = free, filled = booked (Name | @username | phone)

Install openpyxl once:
  pip install openpyxl

Run:
  python generate_schedule.py
"""

from datetime import date, timedelta
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# ── Config ─────────────────────────────────────────────────────────────────
START_DATE  = date(2025, 1, 1)
END_DATE    = date(2027, 12, 31)
HOURS       = list(range(9, 22))          # 9, 10, 11, … 21  → 13 slots
SHEET_NAME  = "schedule"
OUTPUT_FILE = "schedule.xlsx"

# ── Styles ─────────────────────────────────────────────────────────────────
HEADER_FILL  = PatternFill("solid", fgColor="2C7873")   # dark teal
HEADER_FONT  = Font(bold=True, color="FFFFFF", size=10)
DATE_FILL    = PatternFill("solid", fgColor="D9EAD3")   # light green
WEEKEND_FILL = PatternFill("solid", fgColor="FCE5CD")   # light orange
FREE_FILL    = PatternFill("solid", fgColor="FFFFFF")
BOOKED_FILL  = PatternFill("solid", fgColor="EA9999")   # light red placeholder

THIN = Side(style="thin", color="CCCCCC")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

CENTER = Alignment(horizontal="center", vertical="center", wrap_text=False)
LEFT   = Alignment(horizontal="left",   vertical="center", wrap_text=False)


def make_header(ws, hours):
    ws.column_dimensions["A"].width = 12
    for col_idx, hour in enumerate(hours, start=2):
        ws.column_dimensions[get_column_letter(col_idx)].width = 22

    ws.row_dimensions[1].height = 22

    # Date column
    cell = ws.cell(row=1, column=1, value="Дата")
    cell.font      = HEADER_FONT
    cell.fill      = HEADER_FILL
    cell.alignment = CENTER
    cell.border    = BORDER

    # Hour columns
    for col_idx, hour in enumerate(hours, start=2):
        cell = ws.cell(row=1, column=col_idx, value=f"{hour:02d}:00")
        cell.font      = HEADER_FONT
        cell.fill      = HEADER_FILL
        cell.alignment = CENTER
        cell.border    = BORDER


def fill_dates(ws, start: date, end: date, hours):
    current = start
    row = 2
    while current <= end:
        ws.row_dimensions[row].height = 18

        is_weekend = current.weekday() >= 5   # Sat=5, Sun=6
        date_fill  = WEEKEND_FILL if is_weekend else DATE_FILL

        # Date cell  — format DD.MM.YYYY
        cell = ws.cell(row=row, column=1, value=current.strftime("%d.%m.%Y"))
        cell.font      = Font(bold=is_weekend, size=9)
        cell.fill      = date_fill
        cell.alignment = CENTER
        cell.border    = BORDER

        # One cell per hour slot — leave empty (= free)
        for col_idx in range(2, 2 + len(hours)):
            cell = ws.cell(row=row, column=col_idx, value="")
            cell.fill      = FREE_FILL
            cell.alignment = LEFT
            cell.border    = BORDER

        current += timedelta(days=1)
        row += 1

    return row - 1   # last data row


def main():
    wb = Workbook()
    ws = wb.active
    ws.title = SHEET_NAME
    ws.freeze_panes = "B2"          # freeze header row and date column

    make_header(ws, HOURS)
    last_row = fill_dates(ws, START_DATE, END_DATE, HOURS)

    # Auto-filter on header row
    last_col = get_column_letter(1 + len(HOURS))
    ws.auto_filter.ref = f"A1:{last_col}1"

    # Sheet-level print settings (optional, nice for printing)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth  = 1

    wb.save(OUTPUT_FILE)
    total_days  = (END_DATE - START_DATE).days + 1
    total_slots = total_days * len(HOURS)
    print(f"✅  Saved {OUTPUT_FILE}")
    print(f"    Days:        {total_days}")
    print(f"    Hours/day:   {len(HOURS)}  ({HOURS[0]:02d}:00 – {HOURS[-1]:02d}:00)")
    print(f"    Total slots: {total_slots:,}")
    print()
    print("Next step — upload to Google Sheets:")
    print("  1. Open sheets.google.com → New → Import → Upload schedule.xlsx")
    print("  2. Choose 'Replace spreadsheet' or add as new sheet named 'schedule'")
    print("  3. Make sure your service account has Editor access to the spreadsheet")


if __name__ == "__main__":
    main()
