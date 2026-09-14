# OCR helper for screenshots/images.
# Usage:
#   powershell -File scripts/ocr.ps1 <file-or-folder> [lang]
#   e.g. powershell -File scripts/ocr.ps1 shot.png
#        powershell -File scripts/ocr.ps1 shots v"vie+eng"

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Path,
  [Parameter(Position = 1)]
  [string]$Lang = "vie+eng"
)

$ErrorActionPreference = "Stop"

$tesseract = "C:\Program Files\Tesseract-OCR\tesseract.exe"
if (-not (Test-Path -LiteralPath $tesseract)) {
  throw "Không tìm thấy Tesseract tại $tesseract"
}

$tessdata = Join-Path $env:LOCALAPPDATA "tesseract-oss\tessdata"
if (Test-Path -LiteralPath $tessdata) {
  $env:TESSDATA_PREFIX = $tessdata
}

$extensions = @(".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif")
$items = @()
if (Test-Path -LiteralPath $Path -PathType Container) {
  $items = Get-ChildItem -LiteralPath $Path -Recurse -File |
    Where-Object { $extensions -contains $_.Extension.ToLower() } |
    Sort-Object FullName
} else {
  $items = @(Get-Item -LiteralPath $Path)
}

if ($items.Count -eq 0) {
  Write-Output "Không có ảnh nào để đọc."
  exit 0
}

foreach ($item in $items) {
  Write-Output "===== $($item.Name) ====="
  & $tesseract $item.FullName stdout -l $Lang 2>$null
  Write-Output ""
}
