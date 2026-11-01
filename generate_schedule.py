"""
Generate schedule.xlsx — booking table for TTM Massage Bot.

NEW STRUCTURE:
  Row 1     — header: Час | 01.11.2026 | 02.11.2026 | ...  (dates as columns)
  Col A     — time slots: 09:00, 10:00, ... 21:00
  Col B+    — one column per day from START_DATE to END_DATE
  Cell value: empty = free, text = booked (green fill)

Run:
  python generate_schedule.py
"""

from datetime import date, timedelta
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# ── Config ──────────────────────────────────────────────────────────────────
START_DATE  = date(2026, 11, 1)   # start from today
END_DATE    = date(2027, 12, 31)
HOURS       = list(range(9, 22))  # 9..21 → 13 slots
SHEET_NAME  = "schedule"
OUTPUT_FILE = "schedule_new.xlsx"

# ── Styles ───────────────────────────────────────────────────────────────────
HEADER_FILL   = PatternFill("solid", fgColor="1E3A5F")   # dark blue
HEADER_FONT   = Font(bold=True, color="FFFFFF", size=9)
TIME_FILL     = PatternFill("solid", fgColor="2C3E50")   # dark slate
TIME_FONT     = Font(bold=True, color="FFFFFF", size=9)
WEEKEND_FILL  = PatternFill("solid", fgColor="2D4A6B")   # slightly lighter blue for weekends
FREE_FILL     = PatternFill("solid", fgColor="FFFFFF")
BOOKED_FILL   = PatternFill("solid", fgColor="27AE60")   # green — booked

THIN  = Side(style="thin",   color="CCCCCC")
THICK = Side(style="medium", color="888888")
BORDER      = Border(left=THIN, right=THIN, top=THIN,  bottom=THIN)
THICK_RIGHT = Border(left=THIN, right=THICK, top=THIN, bottom=THIN)

CENTER = Alignment(horizontal="center", vertical="center")
LEFT   = Alignment(horizontal="left",   vertical="center", wrap_text=False)

DAY_NAMES = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']


def col_width_for_date(is_weekend):
    return 14 if not is_weekend else 14


def main():
    wb = Workbook()
    ws = wb.active
    ws.title = SHEET_NAME

    # Collect all dates
    dates = []
    d = START_DATE
    while d <= END_DATE:
        dates.append(d)
        d += timedelta(days=1)

    total_cols = 1 + len(dates)   # col A = time, col B+ = dates

    # ── Row 1: header ────────────────────────────────────────────────────────
    ws.row_dimensions[1].height = 30

    # Cell A1 — "Час"
    c = ws.cell(row=1, column=1, value="Час")
    c.font      = HEADER_FONT
    c.fill      = HEADER_FILL
    c.alignment = CENTER
    c.border    = THICK_RIGHT
    ws.column_dimensions["A"].width = 7

    # Date headers
    for col_idx, dt in enumerate(dates, start=2):
        is_weekend = dt.weekday() >= 5
        label = f"{DAY_NAMES[dt.weekday()]}\n{dt.strftime('%d.%m')}"
        c = ws.cell(row=1, column=col_idx, value=label)
        c.font      = HEADER_FONT
        c.fill      = WEEKEND_FILL if is_weekend else HEADER_FILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border    = BORDER
        ws.column_dimensions[get_column_letter(col_idx)].width = 13

    # ── Rows 2+: time slots ──────────────────────────────────────────────────
    for row_idx, hour in enumerate(HOURS, start=2):
        ws.row_dimensions[row_idx].height = 22
        time_label = f"{hour:02d}:00"

        # Col A — time label
        c = ws.cell(row=row_idx, column=1, value=time_label)
        c.font      = TIME_FONT
        c.fill      = TIME_FILL
        c.alignment = CENTER
        c.border    = THICK_RIGHT

        # Col B+ — empty booking cells
        for col_idx in range(2, 2 + len(dates)):
            c = ws.cell(row=row_idx, column=col_idx, value="")
            c.fill      = FREE_FILL
            c.alignment = LEFT
            c.border    = BORDER

    # Freeze panes: freeze col A and row 1
    ws.freeze_panes = "B2"

    # Auto-filter on row 1
    ws.auto_filter.ref = f"A1:{get_column_letter(total_cols)}1"

    wb.save(OUTPUT_FILE)
    print(f"✅  Saved {OUTPUT_FILE}")
    print(f"    Date range:  {START_DATE} → {END_DATE}")
    print(f"    Days:        {len(dates)}")
    print(f"    Hours/day:   {len(HOURS)}  ({HOURS[0]:02d}:00 – {HOURS[-1]:02d}:00)")
    print(f"    Total cells: {len(dates) * len(HOURS):,}")
    print()
    print("Upload to Google Sheets:")
    print("  1. Open your schedule spreadsheet")
    print("  2. Delete the old 'schedule' sheet")
    print("  3. Import schedule_new.xlsx → Insert new sheet → rename to 'schedule'")


if __name__ == "__main__":
    main()
