# One-off regen: <CJK>5-ink.png -> <CJK>5-fill.png (fill mode from _seal-and-cut.ps1).
# min-gray is idempotent on the already-gray ink image; then per-row scan fills the
# interior (transparent px between leftmost/rightmost opaque px) with paper #f4f0e6.
# No hardcoded CJK literals (PS5.1 misreads BOM-less UTF-8 as GBK).
Add-Type -AssemblyName System.Drawing
$dir = 'e:\JJBurst\git\assets\image\static'
Get-ChildItem $dir -Filter *.png | Where-Object { $_.Name -match '^[\u4e00-\u9fff]5-ink\.png$' } | ForEach-Object {
    $src0 = [System.Drawing.Bitmap]::FromFile($_.FullName)
    $src = New-Object System.Drawing.Bitmap($src0.Width, $src0.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($src)
    $g.DrawImage($src0, 0, 0)
    $g.Dispose()
    $src0.Dispose()
    $w = $src.Width; $h = $src.Height
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $src.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $len = $data.Stride * $h
    $bytes = New-Object byte[] $len
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $len)
    for ($i = 0; $i -lt $len; $i += 4) {
        # BGRA order; min channel as gray (no-op on already-gray ink, kept for parity)
        $min = $bytes[$i]
        if ($bytes[$i+1] -lt $min) { $min = $bytes[$i+1] }
        if ($bytes[$i+2] -lt $min) { $min = $bytes[$i+2] }
        $bytes[$i] = $min; $bytes[$i+1] = $min; $bytes[$i+2] = $min   # keep alpha
    }
    # per-row scan: fill transparent px between leftmost/rightmost opaque px with paper
    $stride = $data.Stride
    for ($y = 0; $y -lt $h; $y++) {
        $rowStart = $y * $stride
        $L = -1; $R = -1
        for ($x = 0; $x -lt $w; $x++) {
            if ($bytes[$rowStart + $x*4 + 3] -ge 100) { if ($L -lt 0) { $L = $x }; $R = $x }
        }
        if ($L -ge 0) {
            for ($x = $L; $x -le $R; $x++) {
                $i = $rowStart + $x*4
                if ($bytes[$i+3] -lt 100) {
                    $bytes[$i] = 230; $bytes[$i+1] = 240; $bytes[$i+2] = 244; $bytes[$i+3] = 255
                }
            }
        }
    }
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $len)
    $src.UnlockBits($data)
    $out = $_.FullName -replace '-ink\.png$', '-fill.png'
    $src.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $src.Dispose()
    Write-Output ("OK " + $out + " " + $w + "x" + $h)
}
