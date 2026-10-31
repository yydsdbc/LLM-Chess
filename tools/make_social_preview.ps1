# tools/make_social_preview.ps1 — 第86轮: 生成 GitHub 社交预览图 (1280x640 PNG, 零依赖 GDI+)
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File tools/make_social_preview.ps1
# 注意: PS 方法调用参数只能是表达式 — 所有 Brush/Pen/Font 先建变量再传 (inline New-Object 会语法错)
Add-Type -AssemblyName System.Drawing

$W = 1280; $H = 640
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

# 背景: 径向渐变 (暗金主题)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddEllipse(-300, -250, 1900, 1300)
$pbrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
$pbrush.CenterColor = [System.Drawing.Color]::FromArgb(255, 26, 20, 16)
$pbrush.SurroundColors = @([System.Drawing.Color]::FromArgb(255, 8, 6, 7))
$g.FillRectangle($pbrush, 0, 0, $W, $H)

# 画笔/画刷/字体 (全部预建)
$cGold  = [System.Drawing.Color]::FromArgb(255, 240, 217, 160)
$cAmber = [System.Drawing.Color]::FromArgb(255, 224, 160, 48)
$cDim   = [System.Drawing.Color]::FromArgb(255, 200, 176, 136)
$cFaint = [System.Drawing.Color]::FromArgb(255, 160, 136, 88)
$cLine  = [System.Drawing.Color]::FromArgb(255, 122, 90, 42)
$cDark  = [System.Drawing.Color]::FromArgb(255, 20, 16, 10)
$cInk   = [System.Drawing.Color]::FromArgb(255, 26, 14, 8)
$brGold  = New-Object System.Drawing.SolidBrush($cGold)
$brAmber = New-Object System.Drawing.SolidBrush($cAmber)
$brDim   = New-Object System.Drawing.SolidBrush($cDim)
$brFaint = New-Object System.Drawing.SolidBrush($cFaint)
$brLine  = New-Object System.Drawing.SolidBrush($cLine)
$brDark  = New-Object System.Drawing.SolidBrush($cDark)
$brInk   = New-Object System.Drawing.SolidBrush($cInk)
$brTagBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 224, 160, 48))
$penLine = New-Object System.Drawing.Pen($cLine, 3)
$penGrid = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 122, 90, 42), 1)
$fBrand = New-Object System.Drawing.Font('Microsoft YaHei', 15, [System.Drawing.FontStyle]::Bold)
$fH1    = New-Object System.Drawing.Font('Microsoft YaHei', 34, [System.Drawing.FontStyle]::Bold)
$fSub   = New-Object System.Drawing.Font('Microsoft YaHei', 13.5)
$fTag   = New-Object System.Drawing.Font('Microsoft YaHei', 10.5)
$fUrl   = New-Object System.Drawing.Font('Consolas', 12.5, [System.Drawing.FontStyle]::Bold)
$fRiver = New-Object System.Drawing.Font('Microsoft YaHei', 13)
$fVs    = New-Object System.Drawing.Font('Microsoft YaHei', 12, [System.Drawing.FontStyle]::Bold)
$fPiece = New-Object System.Drawing.Font('Microsoft YaHei', 17, [System.Drawing.FontStyle]::Bold)

# 左侧文案
$g.DrawString('LLM-Chess · 象棋 × 大模型', $fBrand, $brFaint, 70, 60)
$g.DrawString('看 AI 模型', $fH1, $brGold, 70, 120)
$g.DrawString('边想、边吵、边下棋', $fH1, $brAmber, 70, 190)
$g.DrawString("多模型委员会会诊 / 圆桌辩论 · 实时决策卡片与投票明细`nElo 天梯 · 可复现无头基准 · 浏览器直连 BYOK", $fSub, $brDim, 72, 285)

# 标签胶囊
$tags = @('16 家服务商', '零依赖', 'PWA 离线可玩', '27 套件 CI')
$x = 72
foreach ($t in $tags) {
  $sz = $g.MeasureString($t, $fTag)
  $tw = [int]($sz.Width) + 26
  $g.FillRectangle($brTagBg, $x, 380, $tw, 34)
  $g.DrawRectangle($penGrid, $x, 380, $tw, 34)
  $g.DrawString($t, $fTag, $brDim, ($x + 12), 385)
  $x += $tw + 14
}
$g.DrawString('github.com/yydsdbc/LLM-Chess  > 在线即玩', $fUrl, $brAmber, 72, 470)

# 右侧迷你棋盘
$bx = 810; $by = 60; $bw = 400; $bh = 470
$g.FillRectangle($brDark, $bx, $by, $bw, $bh)
$g.DrawRectangle($penLine, $bx, $by, $bw, $bh)
$halfT = $by + [int]($bh * 0.45)
$halfB = $by + [int]($bh * 0.55)
for ($i = 0; $i -le 8; $i++) {
  $cx = $bx + [int]($i * $bw / 8)
  $g.DrawLine($penGrid, $cx, $by, $cx, $halfT)
  $g.DrawLine($penGrid, $cx, $halfB, $cx, ($by + $bh))
}
for ($j = 0; $j -le 9; $j++) {
  $cy = $by + [int]($j * $bh / 9)
  $g.DrawLine($penGrid, $bx, $cy, ($bx + $bw), $cy)
}
$g.DrawString('楚 河          汉 界', $fRiver, $brLine, ($bx + 60), ($by + 185))

# 棋子
function Draw-Piece([int]$px, [int]$py, [string]$ch, [string]$kind) {
  $r = 34
  if ($kind -eq 'red') {
    $fill = [System.Drawing.Color]::FromArgb(255, 61, 26, 16)
    $edge = [System.Drawing.Color]::FromArgb(255, 224, 106, 74)
    $txt  = [System.Drawing.Color]::FromArgb(255, 255, 181, 154)
  } else {
    $fill = [System.Drawing.Color]::FromArgb(255, 16, 24, 38)
    $edge = [System.Drawing.Color]::FromArgb(255, 90, 134, 200)
    $txt  = [System.Drawing.Color]::FromArgb(255, 184, 212, 240)
  }
  $pc = New-Object System.Drawing.SolidBrush($fill)
  $pe = New-Object System.Drawing.Pen($edge, 3)
  $pt = New-Object System.Drawing.SolidBrush($txt)
  $g.FillEllipse($pc, ($px - $r), ($py - $r), (2 * $r), (2 * $r))
  $g.DrawEllipse($pe, ($px - $r), ($py - $r), (2 * $r), (2 * $r))
  $szp = $g.MeasureString($ch, $fPiece)
  $g.DrawString($ch, $fPiece, $pt, ($px - [int]($szp.Width / 2)), ($py - [int]($szp.Height / 2) - 2))
}
Draw-Piece ($bx + 80)  ($by + 420) '帅' 'red'
Draw-Piece ($bx + 260) ($by + 320) '炮' 'red'
Draw-Piece ($bx + 140) ($by + 50)  '将' 'black'
Draw-Piece ($bx + 320) ($by + 150) '车' 'black'
Draw-Piece ($bx + 350) ($by + 420) '兵' 'red'

# LLM vs LLM 徽章
$vsX = $bx + $bw - 170
$g.FillRectangle($brAmber, $vsX, ($by - 16), 160, 36)
$szv = $g.MeasureString('LLM vs LLM', $fVs)
$g.DrawString('LLM vs LLM', $fVs, $brInk, ($vsX + [int]((160 - $szv.Width) / 2)), ($by - 10))

$out = Join-Path $PSScriptRoot '..\docs\social-preview.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host ("saved: " + (Resolve-Path $out).Path)
