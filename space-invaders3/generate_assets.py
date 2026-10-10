"""Generate pixel-art PNG assets for the Space Invaders game.

Sprites are authored as explicit pixel grids and upscaled with nearest-neighbour
so the result keeps hard pixel edges (no anti-aliasing), matching the retro look.
Output sizes are 2x the in-game display size for crispness.

Run:  python generate_assets.py
"""

import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")

TRANSPARENT = (0, 0, 0, 0)

#  The ship is authored in greyscale so it can be coloured with setTint().
#  Tint is multiplicative: tinting a pure-green texture red yields black.
SHIP = (235, 235, 235, 255)
SHIP_LIGHT = (255, 255, 255, 255)
SHIP_DARK = (140, 140, 140, 255)

CYAN = (0, 255, 255, 255)
CYAN_LIGHT = (170, 255, 255, 255)
CYAN_DARK = (0, 145, 160, 255)

#  Bonus saucer is drawn in full colour: it is never tinted.
UFO_BODY = (220, 40, 120, 255)
UFO_BODY_LIGHT = (255, 120, 180, 255)
UFO_BODY_DARK = (140, 15, 75, 255)
UFO_GLASS = (190, 240, 255, 255)
UFO_GLASS_DARK = (95, 170, 220, 255)
UFO_LAMP = (255, 230, 90, 255)

#  Shield blocks are greyscale so setTint() can colour them per damage stage.
SHIELD = (225, 225, 225, 255)
SHIELD_LIGHT = (255, 255, 255, 255)
SHIELD_DARK = (150, 150, 150, 255)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def grid_to_image(grid, palette, scale, canvas_size=None):
    """Render a list of equal-length strings into an upscaled RGBA image."""
    h = len(grid)
    w = len(grid[0])
    for row in grid:
        assert len(row) == w, "all grid rows must have equal width"

    img = Image.new("RGBA", (w, h), TRANSPARENT)
    px = img.load()
    for y in range(h):
        for x in range(w):
            colour = palette.get(grid[y][x])
            if colour:
                px[x, y] = colour

    img = img.resize((w * scale, h * scale), Image.NEAREST)

    if canvas_size:
        canvas = Image.new("RGBA", canvas_size, TRANSPARENT)
        canvas.paste(img, ((canvas_size[0] - img.width) // 2,
                           (canvas_size[1] - img.height) // 2))
        img = canvas
    return img


def shade_vertical(grid, fill="X"):
    """Light the top edge of each column and darken the bottom edge."""
    h = len(grid)
    out = []
    for y in range(h):
        row = []
        for x, cell in enumerate(grid[y]):
            if cell != fill:
                row.append(".")
                continue
            above = y > 0 and grid[y - 1][x] == fill
            below = y < h - 1 and grid[y + 1][x] == fill
            if not above and below:
                row.append("L")
            elif above and not below:
                row.append("D")
            else:
                row.append("C")
        out.append("".join(row))
    return out


def shade_horizontal(grid, fill="G"):
    """Light the left rim and darken the right rim of each row."""
    out = []
    for row in grid:
        cells = list(row)
        filled = [i for i, c in enumerate(cells) if c == fill]
        if filled:
            cells[filled[0]] = "L"
            cells[filled[-1]] = "D"
        out.append("".join(cells))
    return out


def save(img, name):
    path = os.path.join(OUT_DIR, name)
    img.save(path)
    print("{:<24} {}x{}".format(name, img.width, img.height))


# --------------------------------------------------------------------------- #
# 1. player ship  (120 x 40, displayed at 60 x 20)
# --------------------------------------------------------------------------- #
def make_player():
    grid = [
        ".............GGGG.............",
        ".............GGGG.............",
        ".............GGGG.............",
        "..........GGGGGGGGGG..........",
        "..........GGGGGGGGGG..........",
        "..GGGGGGGGGGGGGGGGGGGGGGGGGG..",
        "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
        "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
        "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
        "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    ]
    grid = shade_horizontal(grid)
    palette = {"G": SHIP, "L": SHIP_LIGHT, "D": SHIP_DARK}
    return grid_to_image(grid, palette, scale=4)


# --------------------------------------------------------------------------- #
# 2-5. invaders  (80 x 80 each, displayed at 40 x 40)
# --------------------------------------------------------------------------- #
SQUID_A = [
    "...XX...",
    "..XXXX..",
    ".XXXXXX.",
    "XX.XX.XX",
    "XXXXXXXX",
    "..X..X..",
    ".X.XX.X.",
    "X.X..X.X",
]
SQUID_B = [
    "...XX...",
    "..XXXX..",
    ".XXXXXX.",
    "XX.XX.XX",
    "XXXXXXXX",
    ".X.XX.X.",
    "X......X",
    ".X....X.",
]

CRAB_A = [
    "..X.....X..",
    "...X...X...",
    "..XXXXXXX..",
    ".XX.XXX.XX.",
    "XXXXXXXXXXX",
    "X.XXXXXXX.X",
    "X.X.....X.X",
    "...XX.XX...",
]
CRAB_B = [
    "..X.....X..",
    "X..X...X..X",
    "X.XXXXXXX.X",
    "XXX.XXX.XXX",
    "XXXXXXXXXXX",
    ".XXXXXXXXX.",
    "..X.....X..",
    ".X.......X.",
]

OCTOPUS_A = [
    "....XXXX....",
    ".XXXXXXXXXX.",
    "XXXXXXXXXXXX",
    "XXX..XX..XXX",
    "XXXXXXXXXXXX",
    "...XX..XX...",
    "..XX.XX.XX..",
    "XX........XX",
]
OCTOPUS_B = [
    "....XXXX....",
    ".XXXXXXXXXX.",
    "XXXXXXXXXXXX",
    "XXX..XX..XXX",
    "XXXXXXXXXXXX",
    "..XXX..XXX..",
    ".XX..XX..XX.",
    "..XX....XX..",
]

INVADER_PALETTE = {"C": CYAN, "L": CYAN_LIGHT, "D": CYAN_DARK}
FRAME = 80


def make_invader(grid):
    scale = min(FRAME // len(grid[0]), FRAME // len(grid))
    return grid_to_image(shade_vertical(grid), INVADER_PALETTE, scale,
                         canvas_size=(FRAME, FRAME))


def make_invader_sheet(grid_a, grid_b):
    sheet = Image.new("RGBA", (FRAME * 2, FRAME), TRANSPARENT)
    sheet.paste(make_invader(grid_a), (0, 0))
    sheet.paste(make_invader(grid_b), (FRAME, 0))
    return sheet


# --------------------------------------------------------------------------- #
# 6-7. bullets  (8 x 24, displayed at 4 x 12)
# --------------------------------------------------------------------------- #
def make_player_bullet():
    img = Image.new("RGBA", (8, 24), TRANSPARENT)
    px = img.load()
    for y in range(24):
        if y in (0, 23):
            cols = range(3, 5)
        elif y in (1, 22):
            cols = range(2, 6)
        else:
            cols = range(1, 7)
        for x in cols:
            d = abs(x - 3.5)
            if d < 1:
                px[x, y] = (255, 255, 225, 255)
            elif d < 2:
                px[x, y] = (255, 255, 0, 255)
            else:
                px[x, y] = (255, 140, 0, 230)
    return img.resize((16, 48), Image.NEAREST)


def make_invader_bullet():
    img = Image.new("RGBA", (8, 24), TRANSPARENT)
    px = img.load()
    zig = [-1, 0, 1, 2, 1, 0, -1, -2]
    for y in range(24):
        cx = 3 + zig[y % 8]
        for dx in (-1, 0, 1):
            x = cx + dx
            if 0 <= x < 8:
                px[x, y] = (225, 255, 255, 255) if dx == 0 else CYAN
    return img.resize((16, 48), Image.NEAREST)


# --------------------------------------------------------------------------- #
# 8. explosion sheet  (5 frames of 80 x 80)
# --------------------------------------------------------------------------- #
def make_explosion_sheet():
    cells, scale = 20, 4
    frames = 5
    sheet = Image.new("RGBA", (FRAME * frames, FRAME), TRANSPARENT)
    rng = random.Random(7)

    radii = [3, 6, 9, 12, 15]
    centre = (cells - 1) / 2.0

    for f in range(frames):
        img = Image.new("RGBA", (cells, cells), TRANSPARENT)
        px = img.load()
        r = radii[f]
        inner = 0 if f < 2 else r - 4
        for y in range(cells):
            for x in range(cells):
                d = math.hypot(x - centre, y - centre) + rng.uniform(-0.8, 0.8)
                if d > r or d < inner:
                    continue
                if f >= 3 and rng.random() < 0.45:
                    continue
                t = d / max(r, 1)
                if f == 0:
                    colour = (255, 255, 255, 255)
                elif t < 0.35:
                    colour = (255, 255, 220, 255)
                elif t < 0.65:
                    colour = (255, 210, 60, 255)
                elif t < 0.85:
                    colour = (255, 130, 20, 245)
                else:
                    colour = (200, 45, 20, 225)
                if f == 4:
                    colour = (185, 50, 25, 200)
                px[x, y] = colour

        # scattered debris on the later frames
        if f >= 2:
            for _ in range(10):
                a = rng.uniform(0, math.tau)
                dist = r + rng.uniform(0.5, 3.0)
                x = int(round(centre + math.cos(a) * dist))
                y = int(round(centre + math.sin(a) * dist))
                if 0 <= x < cells and 0 <= y < cells:
                    px[x, y] = (255, 180, 60, 210)

        sheet.paste(img.resize((FRAME, FRAME), Image.NEAREST), (f * FRAME, 0))
    return sheet


# --------------------------------------------------------------------------- #
# 9. background  (1600 x 1200, displayed at 800 x 600)
# --------------------------------------------------------------------------- #
def make_background():
    w, h = 1600, 1200
    img = Image.new("RGBA", (w, h), (5, 5, 16, 255))
    rng = random.Random(42)

    # soft nebula haze in the corners, kept very low contrast
    haze = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    hd = ImageDraw.Draw(haze)
    blobs = [
        (-200, -200, 700, 700, (60, 20, 90, 70)),
        (w - 600, -250, w + 250, 600, (20, 30, 90, 60)),
        (-250, h - 650, 500, h + 200, (35, 15, 70, 60)),
        (w - 500, h - 500, w + 250, h + 250, (18, 35, 80, 55)),
    ]
    for x0, y0, x1, y1, colour in blobs:
        hd.ellipse([x0, y0, x1, y1], fill=colour)
    haze = haze.filter(ImageFilter.GaussianBlur(160))
    img = Image.alpha_composite(img, haze)

    draw = ImageDraw.Draw(img)
    for _ in range(900):
        x = rng.randrange(w)
        y = rng.randrange(h)
        size = rng.choice([2, 2, 2, 4, 4, 6])
        bright = rng.randint(90, 255)
        colour = rng.choice([
            (bright, bright, bright, 255),
            (bright - 40, bright - 20, 255, 255),
            (255, bright - 30, bright - 50, 255),
        ])
        colour = tuple(max(0, min(255, c)) for c in colour)
        draw.rectangle([x, y, x + size - 1, y + size - 1], fill=colour)
    return img


# --------------------------------------------------------------------------- #
# 10. bonus saucer  (160 x 64, displayed at 60 x 24)
# --------------------------------------------------------------------------- #
def make_bonus_ship():
    grid = [
        ".......GGGGGG.......",
        ".....GGGGGGGGGG.....",
        "....GGggGGGGggGG....",
        "..BBBBBBBBBBBBBBBB..",
        "BBBBBBBBBBBBBBBBBBBB",
        "BBBBBBBBBBBBBBBBBBBB",
        ".LL..LL..LL..LL..LL.",
        "....BB......BB......",
    ]
    palette = {
        "G": UFO_GLASS,
        "g": UFO_GLASS_DARK,
        "B": UFO_BODY,
        "L": UFO_LAMP,
    }

    #  Brighten the saucer's leading row and darken its underside.
    shaded = []
    for y, row in enumerate(grid):
        if y == 3:
            shaded.append(row.replace("B", "l"))
        elif y == 5:
            shaded.append(row.replace("B", "d"))
        else:
            shaded.append(row)
    palette["l"] = UFO_BODY_LIGHT
    palette["d"] = UFO_BODY_DARK

    return grid_to_image(shaded, palette, scale=8)


# --------------------------------------------------------------------------- #
# 11. shield block  (16 x 16, displayed at 10 x 10)
# --------------------------------------------------------------------------- #
def make_shield_block():
    grid = [
        "LLLLLLLL",
        "LGGGGGGD",
        "LGGGGGGD",
        "LGGGGGGD",
        "LGGGGGGD",
        "LGGGGGGD",
        "LGGGGGGD",
        "DDDDDDDD",
    ]
    palette = {"G": SHIELD, "L": SHIELD_LIGHT, "D": SHIELD_DARK}
    return grid_to_image(grid, palette, scale=2)


# --------------------------------------------------------------------------- #
# 12. power-up capsules  (8 frames of 48 x 48, displayed at 24 x 24)
# --------------------------------------------------------------------------- #
#  Frame order must match POWER_TYPES in space-invaders.html:
#  0 rapid, 1 multi, 2 laser, 3 life, 4 twin, 5 push, 6 nuke, 7 shield,
#  8 scramble.
POWER_GLYPHS = [
    [   # rapid fire: stacked chevrons
        "...XX...",
        "..XXXX..",
        ".XX..XX.",
        "........",
        "...XX...",
        "..XXXX..",
        ".XX..XX.",
        "........",
    ],
    [   # multi shot: three bullet trails
        "X..X..X.",
        "X..X..X.",
        "X..X..X.",
        "........",
        "X..X..X.",
        "X..X..X.",
        "X..X..X.",
        "........",
    ],
    [   # laser: one fat beam
        "...XX...",
        "...XX...",
        "...XX...",
        "...XX...",
        "...XX...",
        "..XXXX..",
        "...XX...",
        "...XX...",
    ],
    [   # extra life: heart
        ".XX..XX.",
        "XXXXXXXX",
        "XXXXXXXX",
        "XXXXXXXX",
        ".XXXXXX.",
        "..XXXX..",
        "...XX...",
        "........",
    ],
    [   # twin ship: two cannons
        "........",
        ".X....X.",
        "XXX..XXX",
        "X.X..X.X",
        "........",
        "..X..X..",
        ".XXXXXX.",
        "........",
    ],
    [   # push back: arrow shoving the swarm into the ceiling
        "XXXXXXXX",
        "........",
        "...XX...",
        "..XXXX..",
        ".XXXXXX.",
        "XX.XX.XX",
        "...XX...",
        "...XX...",
    ],
    [   # mega bomb: starburst
        "X..XX..X",
        ".X.XX.X.",
        "..XXXX..",
        "XXXXXXXX",
        "XXXXXXXX",
        "..XXXX..",
        ".X.XX.X.",
        "X..XX..X",
    ],
    [   # force field: shield crest
        "XXXXXXXX",
        "X......X",
        "X......X",
        "X......X",
        ".X....X.",
        "..X..X..",
        "...XX...",
        "........",
    ],
    [   # scramble: two arrows swapping places
        "..X.....",
        ".XXXXXXX",
        "..X....X",
        "........",
        "........",
        "X....X..",
        "XXXXXXX.",
        ".....X..",
    ],
]

POWER_COLOURS = [
    (255, 190, 40, 255),   # rapid
    (255, 120, 40, 255),   # multi
    (255, 60, 60, 255),    # laser
    (60, 230, 110, 255),   # life
    (70, 200, 255, 255),   # twin
    (170, 120, 255, 255),  # push
    (255, 70, 190, 255),   # nuke
    (200, 215, 235, 255),  # shield
    (60, 220, 190, 255),   # scramble
]

POWER_FRAME = 48


def make_powerup_sheet():
    #  Capsules are drawn 4x oversized and downsampled so the rounded shell is
    #  smooth, then a blurred copy is laid underneath for a soft glow.
    frames = len(POWER_GLYPHS)
    size = POWER_FRAME
    over = 4
    inset = 7
    glyph_size = 20
    sheet = Image.new("RGBA", (size * frames, size), TRANSPARENT)

    for index, glyph in enumerate(POWER_GLYPHS):
        body = POWER_COLOURS[index]
        edge = tuple(min(255, c + 70) for c in body[:3]) + (255,)

        big = Image.new("RGBA", (size * over, size * over), TRANSPARENT)
        draw = ImageDraw.Draw(big)
        draw.rounded_rectangle(
            [inset * over, inset * over,
             (size - inset) * over - 1, (size - inset) * over - 1],
            radius=8 * over,
            fill=body,
            outline=edge,
            width=2 * over,
        )
        capsule = big.resize((size, size), Image.LANCZOS)

        #  The 8x8 glyph is upscaled hard, then softened just enough to lose the
        #  jagged staircase without going blurry.
        stamp = Image.new("RGBA", (8, 8), TRANSPARENT)
        px = stamp.load()
        for gy, row in enumerate(glyph):
            for gx, cell in enumerate(row):
                if cell == "X":
                    px[gx, gy] = (255, 255, 255, 255)
        stamp = stamp.resize((glyph_size, glyph_size), Image.NEAREST)
        stamp = stamp.filter(ImageFilter.GaussianBlur(0.7))
        capsule.alpha_composite(stamp, ((size - glyph_size) // 2,
                                        (size - glyph_size) // 2))

        glow = capsule.filter(ImageFilter.GaussianBlur(4))
        glow.putalpha(glow.getchannel("A").point(lambda a: int(a * 0.6)))

        sheet.paste(Image.alpha_composite(glow, capsule), (index * size, 0))

    return sheet


# --------------------------------------------------------------------------- #
# 13. laser beam  (16 x 32, stretched vertically in game)
# --------------------------------------------------------------------------- #
def make_laser_beam():
    w, h = 16, 32
    img = Image.new("RGBA", (w, h), TRANSPARENT)
    px = img.load()
    centre = (w - 1) / 2.0
    for x in range(w):
        d = abs(x - centre)
        if d < 1.5:
            colour = (255, 255, 255, 255)
        elif d < 3.5:
            colour = (255, 235, 140, 250)
        elif d < 5.5:
            colour = (255, 120, 60, 225)
        elif d < 7.5:
            colour = (220, 40, 40, 170)
        else:
            colour = (150, 20, 20, 90)
        for y in range(h):
            px[x, y] = colour
    return img


# --------------------------------------------------------------------------- #
# 14. force field bubble  (176 x 176, displayed at 88 x 88)
# --------------------------------------------------------------------------- #
def make_force_field():
    #  Soft, mostly transparent bubble: a bright rim with a blurred bloom pass
    #  and a faint swirling interior, so the ship stays readable inside it.
    size = 176
    img = Image.new("RGBA", (size, size), TRANSPARENT)
    px = img.load()
    centre = (size - 1) / 2.0
    radius = size / 2.0 - 8

    for y in range(size):
        for x in range(size):
            dx = x - centre
            dy = y - centre
            d = math.hypot(dx, dy)
            if d > radius + 8:
                continue

            angle = math.atan2(dy, dx)

            #  Rim: a gaussian ring, brighter on four rotating arcs.
            arcs = 0.65 + 0.45 * max(0.0, math.sin(angle * 4.0))
            ring = math.exp(-((d - radius) ** 2) / (2 * 4.5 ** 2)) * arcs

            #  Interior: barely-there haze that thickens toward the rim, plus a
            #  slow swirl so the bubble reads as energy rather than glass.
            haze = 0.0
            swirl = 0.0
            if d < radius:
                t = d / radius
                haze = 0.03 + 0.09 * t ** 3
                swirl = 0.035 * t * (0.5 + 0.5 * math.sin(angle * 6.0 + d * 0.28))

            alpha = min(1.0, ring * 0.8 + haze + swirl)
            if alpha <= 0.004:
                continue

            #  Pale cyan-white on the rim, deeper blue through the middle.
            red = int(90 + 150 * ring)
            green = int(185 + 65 * ring)
            px[x, y] = (min(red, 255), min(green, 255), 255, int(alpha * 255))

    #  Bloom: a blurred copy underneath the crisp pass.
    glow = img.filter(ImageFilter.GaussianBlur(9))
    glow.putalpha(glow.getchannel("A").point(lambda a: int(a * 0.65)))
    return Image.alpha_composite(glow, img)


# --------------------------------------------------------------------------- #
# 15. gift glow  (96 x 96, tinted per capsule and drawn behind it)
# --------------------------------------------------------------------------- #
def make_glow():
    #  Pure white so setTint() can colour it per power-up, with a smooth
    #  falloff to nothing at the edge.
    size = 96
    img = Image.new("RGBA", (size, size), TRANSPARENT)
    px = img.load()
    centre = (size - 1) / 2.0
    radius = size / 2.0

    for y in range(size):
        for x in range(size):
            d = math.hypot(x - centre, y - centre) / radius
            if d >= 1.0:
                continue
            px[x, y] = (255, 255, 255, int(((1.0 - d) ** 1.7) * 245))

    return img.filter(ImageFilter.GaussianBlur(2))


# --------------------------------------------------------------------------- #
def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    save(make_player(), "player.png")

    save(make_invader(SQUID_A), "invader_a.png")
    save(make_invader(CRAB_A), "invader_b.png")
    save(make_invader(OCTOPUS_A), "invader_c.png")

    save(make_invader_sheet(SQUID_A, SQUID_B), "invader_a_sheet.png")
    save(make_invader_sheet(CRAB_A, CRAB_B), "invader_b_sheet.png")
    save(make_invader_sheet(OCTOPUS_A, OCTOPUS_B), "invader_c_sheet.png")

    save(make_player_bullet(), "bullet_player.png")
    save(make_invader_bullet(), "bullet_invader.png")

    save(make_explosion_sheet(), "explosion_sheet.png")
    save(make_bonus_ship(), "bonus_ship.png")
    save(make_shield_block(), "shield_block.png")
    save(make_powerup_sheet(), "powerup_sheet.png")
    save(make_laser_beam(), "laser_beam.png")
    save(make_force_field(), "force_field.png")
    save(make_glow(), "powerup_glow.png")
    save(make_background(), "background.png")

    print("\nAssets written to: {}".format(OUT_DIR))


if __name__ == "__main__":
    main()
