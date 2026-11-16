import ExcelJS from "exceljs";
import type { ReportExportTable } from "./report-export";

/** Lazy-loaded only when an operator requests the formatted Excel download. */
export async function createReportXlsx(table: ReportExportTable, title: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "I-solution Manager";
  workbook.title = title;
  const sheet = workbook.addWorksheet("Danh sách", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.addRow(table.headers);
  sheet.addRows(table.rows);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: table.rows.length + 1, column: table.headers.length } };
  sheet.pageSetup.printTitlesRow = "1:1";
  sheet.columns.forEach((column, index) => {
    const kind = table.kinds[index];
    const contentWidth = Math.max(0, ...table.rows.slice(0, 300).map((row) => String(row[index] ?? "").split(/\r?\n/).reduce((width, line) => Math.max(width, line.length), 0)));
    column.width = index === 0 ? 7 : kind === "date" ? 23 : kind === "status" ? 24 : kind === "number" ? 16
      : Math.min(46, Math.max(24, Math.min(table.headers[index].length, 34) + 2, contentWidth + 2));
    column.numFmt = kind === "number" ? "#,##0.##" : "@";
  });
  sheet.eachRow((row, rowNumber) => {
    let lines = 1;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const isHeader = rowNumber === 1;
      cell.font = { name: "Calibri", size: 11, bold: isHeader, color: { argb: isHeader ? "FFFFFFFF" : "FF172D40" } };
      cell.alignment = { vertical: "middle", wrapText: true, horizontal: isHeader || columnNumber === 1 || table.kinds[columnNumber - 1] === "status" ? "center" : table.kinds[columnNumber - 1] === "number" ? "right" : "left" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isHeader ? "FF075985" : rowNumber % 2 === 0 ? "FFF0F7FC" : "FFFFFFFF" } };
      cell.border = { bottom: { style: "hair", color: { argb: "FFD9E5EF" } } };
      const width = Number(sheet.getColumn(columnNumber).width) - 2;
      lines = Math.max(lines, String(cell.value ?? "").split(/\r?\n/).reduce((count, line) => count + Math.max(1, Math.ceil(line.length / width)), 0));
    });
    row.height = rowNumber === 1 ? Math.max(36, Math.min(90, lines * 15 + 12)) : Math.max(28, Math.min(120, lines * 15 + 10));
  });
  return new Uint8Array(await workbook.xlsx.writeBuffer()).buffer;
}
