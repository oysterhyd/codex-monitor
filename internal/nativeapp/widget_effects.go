package nativeapp

import (
	"github.com/egoist/mygo/ui"
	"image"
	"math"
)

// CSS perspective(700px) rotateX/rotateY, sampled in premultiplied RGBA.
// The projection origin is the centre of the metrics row, as in the old UI.
func widgetTilt(src *image.RGBA, m *widgetModel, r ui.Rect, amount, scale float32) *image.RGBA {
	index := max(0, min(3, int(math.Round(float64((r.X-30)/127.25)))))
	ax := float64((.5-m.light[index][1])*5*amount) * math.Pi / 180
	ay := float64((m.light[index][0]-.5)*5*amount) * math.Pi / 180
	ax = math.Max(-.05, math.Min(.05, ax))
	ay = math.Max(-.05, math.Min(.05, ay))
	if math.Abs(ax)+math.Abs(ay) < .00001 {
		return src
	}
	cx, cy := float64((20+r.W/2)*scale), float64((20+r.H/2)*scale)
	parentX := float64(r.X+r.W/2-280) * float64(scale)
	perspective := 700 * float64(scale)
	g, h := math.Cos(ax)*math.Sin(ay)/perspective, -math.Sin(ax)/perspective
	a, b, c, d := math.Cos(ay)-parentX*g, -parentX*h, math.Sin(ax)*math.Sin(ay), math.Cos(ax)
	dst := image.NewRGBA(src.Bounds())
	for y := 0; y < dst.Bounds().Dy(); y++ {
		for x := 0; x < dst.Bounds().Dx(); x++ {
			u, v := float64(x)-cx, float64(y)-cy
			aa, bb, cc, dd := a-u*g, b-u*h, c-v*g, d-v*h
			det := aa*dd - bb*cc
			if math.Abs(det) < 1e-9 {
				continue
			}
			sx, sy := (u*dd-v*bb)/det+cx, (v*aa-u*cc)/det+cy
			widgetSample(dst.Pix[y*dst.Stride+x*4:], src, sx, sy)
		}
	}
	return dst
}
func widgetSample(out []byte, src *image.RGBA, x, y float64) {
	ix, iy := int(math.Floor(x)), int(math.Floor(y))
	fx, fy := x-float64(ix), y-float64(iy)
	var rgba [4]float64
	for dy := 0; dy < 2; dy++ {
		for dx := 0; dx < 2; dx++ {
			px, py := ix+dx, iy+dy
			if px < 0 || py < 0 || px >= src.Bounds().Dx() || py >= src.Bounds().Dy() {
				continue
			}
			wx, wy := 1-fx, 1-fy
			if dx == 1 {
				wx = fx
			}
			if dy == 1 {
				wy = fy
			}
			offset := py*src.Stride + px*4
			for channel := range rgba {
				rgba[channel] += float64(src.Pix[offset+channel]) * wx * wy
			}
		}
	}
	for channel, value := range rgba {
		out[channel] = uint8(math.Round(value))
	}
}

// Three linear-time box passes approximate CSS's Gaussian blur without a
// browser filter or a copy of the desktop behind the transparent surface.
func widgetBlur(src *image.RGBA, sigma float64) *image.RGBA {
	if sigma < .35 {
		return src
	}
	width := int(math.Floor(math.Sqrt(4*sigma*sigma + 1)))
	if width%2 == 0 {
		width--
	}
	width = max(1, width)
	upper := width + 2
	lowerPasses := int(math.Round((12*sigma*sigma - 3*float64(width*width) - 12*float64(width) - 9) / (-4*float64(width) - 4)))
	input := src
	for pass := 0; pass < 3; pass++ {
		size := upper
		if pass < lowerPasses {
			size = width
		}
		radius := (size - 1) / 2
		if radius == 0 {
			continue
		}
		horizontal := image.NewRGBA(src.Bounds())
		output := image.NewRGBA(src.Bounds())
		widgetBoxBlur(input, horizontal, radius, true)
		widgetBoxBlur(horizontal, output, radius, false)
		input = output
	}
	return input
}
func widgetBoxBlur(src, dst *image.RGBA, radius int, horizontal bool) {
	width, height := src.Bounds().Dx(), src.Bounds().Dy()
	lines, length := height, width
	if !horizontal {
		lines, length = width, height
	}
	offset := func(line, at int) int {
		if horizontal {
			return line*src.Stride + at*4
		}
		return at*src.Stride + line*4
	}
	divisor := 2*radius + 1
	for line := 0; line < lines; line++ {
		var sum [4]int
		for at := 0; at <= min(radius, length-1); at++ {
			i := offset(line, at)
			for c := range sum {
				sum[c] += int(src.Pix[i+c])
			}
		}
		for at := 0; at < length; at++ {
			i := offset(line, at)
			for c := range sum {
				dst.Pix[i+c] = uint8((sum[c] + divisor/2) / divisor)
			}
			remove, add := at-radius, at+radius+1
			if remove >= 0 {
				i := offset(line, remove)
				for c := range sum {
					sum[c] -= int(src.Pix[i+c])
				}
			}
			if add < length {
				i := offset(line, add)
				for c := range sum {
					sum[c] += int(src.Pix[i+c])
				}
			}
		}
	}
}
