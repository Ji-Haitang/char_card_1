# Three-mode pixel conversion (no hardcoded CJK; PS5.1 misreads BOM-less UTF-8 as GBK):
#  seal: red seal PNGs (transparent bg) -> -ink.png : gray=min(R,G,B), keep original alpha
#  fill: frame PNGs (transparent bg) -> -fill.png : min-gray ink strokes + per-row scan fills
#        the interior (between leftmost/rightmost opaque px) with paper color #f4f0e6
#  (legacy 'cut' mode abandoned: deriving alpha from gray breaks on RGB-white+alpha-0 pixels)
Add-Type -AssemblyName System.Drawing
$dir = 'e:\JJBurst\git\assets\image\static'
$sealPattern  = '^(\u5c5e\u6027\u67e5\u770b|\u7cfb\u7edf\u8bbe\u7f6e|\u5386\u53f2\u7ba1\u7406|\u8df3\u8fc7\u4e00\u5468|\u8fd4\u56de\u95e8\u6d3e)\.png$'
# matches frame1..frame6 and biankuang (\u8fb9\u6846) - all transparent-bg ink frames
$framePattern = '^([\u4e00-\u9fff][1-6]|\u8fb9\u6846)\.png$'

function Process-Png($path, $mode, $outPath) {
    $src0 = [System.Drawing.Bitmap]::FromFile($path)
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
        $min = $bytes[$i]
        if ($bytes[$i+1] -lt $min) { $min = $bytes[$i+1] }
        if ($bytes[$i+2] -lt $min) { $min = $bytes[$i+2] }
        if ($mode -eq 'seal' -or $mode -eq 'fill') {
            $bytes[$i] = $min; $bytes[$i+1] = $min; $bytes[$i+2] = $min   # keep alpha
        } elseif ($mode -eq 'redfill') {
            # keep original RGB (red frame), only interior paper fill below
        } else {
            $alpha = [int]((255 - [int]$min) * 1.35)
            if ($alpha -gt 255) { $alpha = 255 }
            $bytes[$i] = 30; $bytes[$i+1] = 30; $bytes[$i+2] = 30
            $bytes[$i+3] = [byte]$alpha
        }
    }
    if ($mode -eq 'fill' -or $mode -eq 'redfill') {
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
    }
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $len)
    $src.UnlockBits($data)
    $src.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $src.Dispose()
    Write-Output ("OK " + $outPath + " " + $w + "x" + $h)
}

Get-ChildItem $dir -Filter *.png | Where-Object { $_.Name -match $sealPattern } | ForEach-Object {
    Process-Png $_.FullName 'seal' ($_.FullName -replace '\.png$', '-ink.png')
}
# frame PNGs are already transparent-bg (alpha carries the shape): 'fill' mode =
# min-gray ink + per-row interior paper fill. Output suffix -fill.png.
Get-ChildItem $dir -Filter *.png | Where-Object { $_.Name -match $framePattern } | ForEach-Object {
    Process-Png $_.FullName 'fill' ($_.FullName -replace '\.png$', '-fill.png')
}
# redfill: frame5 keeps its red ink strokes -> 框5-红fill.png (paper-filled red frame)
$kf5 = Get-ChildItem $dir -Filter *.png | Where-Object { $_.Name -eq (([char]0x6846).ToString() + '5.png') }
if ($kf5) {
    $redOut = Join-Path $dir (([char]0x6846).ToString() + '5-' + ([char]0x7ea2).ToString() + 'fill.png')
    Process-Png $kf5.FullName 'redfill' $redOut
}

# crop mode: trim to alpha>=100 bounding box (+2px margin), overwrite in place.
# biankuang.png keeps its frame in the top-left corner with huge transparent padding,
# so it must be cropped after fill or border-image slicing would hit empty space.
function Crop-Png($path) {
    $src0 = [System.Drawing.Bitmap]::FromFile($path)
    $src = New-Object System.Drawing.Bitmap($src0.Width, $src0.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($src)
    $g.DrawImage($src0, 0, 0)
    $g.Dispose()
    $src0.Dispose()
    $w = $src.Width; $h = $src.Height
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $src.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride
    $len = $stride * $h
    $bytes = New-Object byte[] $len
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $len)
    $src.UnlockBits($data)
    $minX = $w; $maxX = -1; $minY = $h; $maxY = -1
    for ($y = 0; $y -lt $h; $y++) {
        $rowStart = $y * $stride
        for ($x = 0; $x -lt $w; $x++) {
            if ($bytes[$rowStart + $x*4 + 3] -ge 100) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    if ($maxX -lt 0) { $src.Dispose(); Write-Output ("SKIP empty " + $path); return }
    $minX = [Math]::Max(0, $minX - 2); $minY = [Math]::Max(0, $minY - 2)
    $maxX = [Math]::Min($w - 1, $maxX + 2); $maxY = [Math]::Min($h - 1, $maxY + 2)
    $cw = $maxX - $minX + 1; $ch = $maxY - $minY + 1
    $dst = New-Object System.Drawing.Bitmap($cw, $ch, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g2 = [System.Drawing.Graphics]::FromImage($dst)
    $g2.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $cw, $ch)), (New-Object System.Drawing.Rectangle($minX, $minY, $cw, $ch)), [System.Drawing.GraphicsUnit]::Pixel)
    $g2.Dispose()
    $src.Dispose()
    $dst.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $dst.Dispose()
    Write-Output ("CROP " + $path + " -> " + $cw + "x" + $ch)
}
$bkFill = Join-Path $dir (([char]0x8fb9).ToString() + ([char]0x6846).ToString() + '-fill.png')
if (Test-Path $bkFill) { Crop-Png $bkFill }
# 边框.png 原图同样框偏左上带大片透明，crop 后供 story-area 边框 (border-image) 使用
$bkRaw = Join-Path $dir (([char]0x8fb9).ToString() + ([char]0x6846).ToString() + '.png')
if (Test-Path $bkRaw) { Crop-Png $bkRaw }
# 山水图底部 31% 为透明带，crop 后 background-position: bottom 才能真正贴底
$mtn = Join-Path $dir (([char]0x6587).ToString() + ([char]0x5b57).ToString() + ([char]0x6846).ToString() + 'or' + ([char]0x5f39).ToString() + ([char]0x7a97).ToString() + ([char]0x5e95).ToString() + ([char]0x90e8).ToString() + ([char]0x7684).ToString() + ([char]0x6c34).ToString() + ([char]0x58a8).ToString() + ([char]0x80cc).ToString() + ([char]0x666f).ToString() + ([char]0x5efa).ToString() + ([char]0x8bae).ToString() + ([char]0x52a0).ToString() + ([char]0x900f).ToString() + ([char]0x660e).ToString() + ([char]0x5ea6).ToString() + ([char]0x4f7f).ToString() + ([char]0x7528).ToString() + '.png')
if (Test-Path $mtn) { Crop-Png $mtn }
# 印章 -ink 图四边有透明留白，crop 到内容包围盒后按钮才能紧贴排列（消除古风底部按钮区的米黄缝隙）
# 匹配 4 个汉字 + -ink.png（排除 框n-ink 历史产物）；不用字面中文名防 GBK 解码坑
Get-ChildItem $dir -Filter '*-ink.png' | Where-Object { $_.Name -match '^[\u4e00-\u9fff]{4}-ink\.png$' } | ForEach-Object {
    Crop-Png $_.FullName
}

# 山水淡化版：alpha×0.3 供 story-area 背景层使用（CSS 背景图没有 opacity，只能预淡化；
# 配合 background-origin: border-box 可让山水衬在枯笔边框之下且贴元素底缘，不用伪元素就不会遮挡其他元素）
function Fade-Png($srcPath, $factor) {
    if (-not (Test-Path $srcPath)) { return }
    $dstPath = $srcPath.Substring(0, $srcPath.Length - 4) + '-fade.png'
    $src = [System.Drawing.Bitmap]::FromFile($srcPath)
    $out = New-Object System.Drawing.Bitmap($src.Width, $src.Height)
    for ($y = 0; $y -lt $src.Height; $y++) {
        for ($x = 0; $x -lt $src.Width; $x++) {
            $px = $src.GetPixel($x, $y)
            $a = [int]($px.A * $factor)
            $out.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($a, $px.R, $px.G, $px.B))
        }
    }
    $out.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose(); $src.Dispose()
    Write-Output "FADE $dstPath factor=$factor"
}
Fade-Png $mtn 0.3
