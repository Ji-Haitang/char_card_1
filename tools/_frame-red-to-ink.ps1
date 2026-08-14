# Convert frame PNGs (white bg, red ink) to ink-black versions (suffix -ink.png)
# Mapping: out_gray = min(R,G,B) -- red strokes (low G/B) become dark ink, white stays white.
# Script avoids hardcoded CJK literals (PS5.1 misreads BOM-less UTF-8 as GBK);
# matches files like <one CJK char><digit>.png e.g. 框1.png
Add-Type -AssemblyName System.Drawing
$dir = 'e:\JJBurst\git\assets\image\static'
Get-ChildItem $dir -Filter *.png | Where-Object { $_.Name -match '^[\u4e00-\u9fff][1-6]\.png$' } | ForEach-Object {
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
        # BGRA order; min channel as gray
        $min = $bytes[$i]
        if ($bytes[$i+1] -lt $min) { $min = $bytes[$i+1] }
        if ($bytes[$i+2] -lt $min) { $min = $bytes[$i+2] }
        $bytes[$i] = $min; $bytes[$i+1] = $min; $bytes[$i+2] = $min
    }
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $len)
    $src.UnlockBits($data)
    $out = $_.FullName -replace '\.png$', '-ink.png'
    $src.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $src.Dispose()
    Write-Output ("OK " + $out + " " + $w + "x" + $h)
}
