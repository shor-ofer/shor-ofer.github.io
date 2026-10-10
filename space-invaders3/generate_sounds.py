"""Generate the game's sound effects as 16-bit mono WAV files.

Nothing is sampled or downloaded: every effect is synthesised from square, saw,
triangle and sine oscillators plus white noise, shaped with simple envelopes and
one-pole filters.  That keeps the whole soundtrack in source control as code,
exactly like the sprite sheets in generate_assets.py.

Run:  python generate_sounds.py
"""

import math
import os
import random
import struct
import wave

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")

#  22 kHz is plenty for chiptune-style effects and keeps the files small.
RATE = 22050

#  Ceiling for a single .wav (see save): staying under 32 KiB keeps every
#  effect inside one media block, which browsers load far more reliably.
MAX_BYTES = 30000


# --------------------------------------------------------------------------- #
# synthesis toolkit
# --------------------------------------------------------------------------- #
def silence(duration):
    return [0.0] * int(RATE * duration)


def osc(duration, freq_start, freq_end=None, shape="square", duty=0.5):
    """One oscillator, optionally gliding exponentially between two pitches."""
    count = int(RATE * duration)
    freq_end = freq_start if freq_end is None else freq_end
    ratio = freq_end / float(freq_start)

    out = [0.0] * count
    phase = 0.0
    for i in range(count):
        t = i / float(max(count - 1, 1))
        phase += (freq_start * (ratio ** t)) / RATE
        frac = phase % 1.0
        if shape == "square":
            out[i] = 1.0 if frac < duty else -1.0
        elif shape == "saw":
            out[i] = 2.0 * frac - 1.0
        elif shape == "triangle":
            out[i] = 4.0 * abs(frac - 0.5) - 1.0
        else:
            out[i] = math.sin(2.0 * math.pi * frac)
    return out


def warble(duration, centre, depth, rate, duty=0.5):
    """A square tone whose pitch wobbles - sirens, scanners, alarms."""
    count = int(RATE * duration)
    out = [0.0] * count
    phase = 0.0
    for i in range(count):
        t = i / float(count)
        freq = centre + depth * math.sin(2.0 * math.pi * rate * t)
        phase += freq / RATE
        out[i] = 1.0 if (phase % 1.0) < duty else -1.0
    return out


def noise(duration, seed):
    rng = random.Random(seed)
    return [rng.uniform(-1.0, 1.0) for _ in range(int(RATE * duration))]


def envelope(samples, attack=0.005, hold=0.0, curve=3.0):
    """Quick attack, optional flat hold, then an exponential fall to nothing."""
    count = len(samples)
    a = max(1, int(RATE * attack))
    h = int(RATE * hold)
    tail = max(1, count - a - h)

    out = [0.0] * count
    for i, sample in enumerate(samples):
        if i < a:
            level = i / float(a)
        elif i < a + h:
            level = 1.0
        else:
            level = (1.0 - (i - a - h) / float(tail)) ** curve
        out[i] = sample * level
    return out


def swell(samples, shape=1.5):
    """Fade in and back out again - used for whooshes."""
    count = len(samples)
    return [s * math.sin(math.pi * i / float(count)) ** shape
            for i, s in enumerate(samples)]


def low_pass(samples, cutoff):
    alpha = (1.0 / RATE) / ((1.0 / (2.0 * math.pi * cutoff)) + (1.0 / RATE))
    out = []
    value = 0.0
    for sample in samples:
        value += alpha * (sample - value)
        out.append(value)
    return out


def high_pass(samples, cutoff):
    rc = 1.0 / (2.0 * math.pi * cutoff)
    alpha = rc / (rc + (1.0 / RATE))
    out = []
    previous_in = 0.0
    value = 0.0
    for sample in samples:
        value = alpha * (value + sample - previous_in)
        previous_in = sample
        out.append(value)
    return out


def gain(samples, amount):
    return [s * amount for s in samples]


def mix(*layers):
    out = [0.0] * max(len(layer) for layer in layers)
    for layer in layers:
        for i, sample in enumerate(layer):
            out[i] += sample
    return out


def join(*parts):
    out = []
    for part in parts:
        out.extend(part)
    return out


def sequence(notes, step, shape="square", duty=0.5, curve=2.0, gap=0.0):
    """A little arpeggio: one enveloped note per entry."""
    parts = []
    for freq in notes:
        parts.append(envelope(osc(step, freq, freq, shape, duty),
                              attack=0.004, hold=step * 0.45, curve=curve))
        if gap:
            parts.append(silence(gap))
    return join(*parts)


def declick(samples, fade=0.004):
    """Ramp the first and last few milliseconds so nothing pops."""
    count = len(samples)
    ramp = min(int(RATE * fade), count // 2)
    if ramp < 2:
        return samples
    out = list(samples)
    for i in range(ramp):
        level = i / float(ramp)
        out[i] *= level
        out[count - 1 - i] *= level
    return out


def halve_rate(samples):
    """Drop to half the sample rate, averaging each pair so nothing aliases."""
    return [(samples[i] + samples[i + 1]) * 0.5
            for i in range(0, len(samples) - 1, 2)]


def save(samples, name, peak=0.82):
    samples = declick(samples)

    #  Browsers stream <audio> in 32 KiB blocks and reading a longer file
    #  straight off the filesystem is unreliable, so anything that would run
    #  over the limit is written at half the sample rate instead.  Only the
    #  long rumbles ever hit this, and they have nothing up high to lose.
    rate = RATE
    while len(samples) * 2 + 44 > MAX_BYTES:
        samples = halve_rate(samples)
        rate //= 2

    loudest = max(abs(s) for s in samples) or 1.0
    scale = peak / loudest

    frames = b"".join(
        struct.pack("<h", int(max(-1.0, min(1.0, s * scale)) * 32767))
        for s in samples
    )

    path = os.path.join(OUT_DIR, name)
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(frames)

    print("{:<24} {:.2f}s  {:>5} Hz  {:>6} bytes".format(
        name, len(samples) / float(rate), rate, len(frames) + 44))


# --------------------------------------------------------------------------- #
# the effects
# --------------------------------------------------------------------------- #
def shoot():
    """Player cannon: the classic short downward blip."""
    body = osc(0.14, 1100, 260, "square", duty=0.35)
    fizz = gain(noise(0.14, 1), 0.22)
    return envelope(mix(body, fizz), attack=0.002, curve=2.5)


def laser():
    """The beam power-up: a long, wide sweep with a sub underneath."""
    beam = osc(0.55, 1800, 180, "saw")
    sub = gain(osc(0.55, 220, 70, "square"), 0.5)
    air = gain(low_pass(noise(0.55, 2), 2500), 0.45)
    return envelope(mix(beam, sub, air), attack=0.01, hold=0.14, curve=2.0)


def invader_die():
    """Invader destroyed: a dry noise burst with a falling tone in it."""
    burst = gain(low_pass(noise(0.34, 3), 1800), 0.9)
    tone = gain(osc(0.34, 420, 90, "square"), 0.6)
    return envelope(mix(burst, tone), attack=0.002, curve=2.4)


def armour_hit():
    """Armour soaking a shot: a bright metallic clink."""
    ring = osc(0.09, 1700, 1500, "square", duty=0.25)
    overtone = gain(osc(0.09, 2600, 2300, "square", duty=0.2), 0.5)
    clink = gain(high_pass(noise(0.09, 4), 2000), 0.4)
    return envelope(mix(ring, overtone, clink), attack=0.001, curve=4.0)


def shield_hit():
    """A bunker block taking damage: a dull, muffled thud."""
    thud = low_pass(noise(0.13, 5), 700)
    body = gain(osc(0.13, 180, 90, "triangle"), 0.7)
    return envelope(mix(thud, body), attack=0.001, curve=3.0)


def player_hit():
    """Losing a life: a long tearing blast."""
    tear = gain(osc(0.7, 300, 50, "saw"), 0.9)
    blast = gain(low_pass(noise(0.7, 6), 1200), 0.9)
    alarm = gain(osc(0.7, 140, 120, "square"), 0.35)
    return envelope(mix(tear, blast, alarm), attack=0.003, hold=0.05, curve=1.8)


def nuke():
    """Mega bomb: a deep rumble with a cracking transient on top."""
    length = 1.15
    blast = low_pass(noise(length, 7), 900)
    rumble = gain(osc(length, 90, 35, "sine"), 0.9)
    crack = gain(high_pass(noise(0.25, 8), 3000), 0.6)
    crack.extend(silence(length - 0.25))
    return envelope(mix(blast, rumble, crack),
                    attack=0.004, hold=0.18, curve=1.6)


def powerup():
    """Capsule collected: a quick rising chirp."""
    return sequence([660, 880, 1320], 0.075, duty=0.4)


def extra_life():
    """+1 life: a brighter, longer fanfare than a normal pickup."""
    return sequence([523, 659, 784, 1047], 0.09, duty=0.45)


def force_field():
    """Bubble coming up: a shimmering rise that settles into a hum."""
    rise = osc(0.7, 260, 900, "sine")
    shimmer = gain(osc(0.7, 520, 1810, "triangle"), 0.4)
    air = gain(high_pass(noise(0.7, 9), 1500), 0.22)
    return envelope(mix(rise, shimmer, air), attack=0.05, hold=0.3, curve=2.0)


def spark():
    """A shot burning up on the force field: a tiny zap."""
    zap = osc(0.09, 2200, 900, "square", duty=0.3)
    hiss = gain(high_pass(noise(0.09, 10), 2500), 0.55)
    return envelope(mix(zap, hiss), attack=0.001, curve=3.5)


def scramble():
    """Swarm reshuffling: a wobbling scanner sweep."""
    scanner = warble(0.55, 500, 350, 9.0)
    sweep = gain(osc(0.55, 300, 1200, "triangle"), 0.4)
    return envelope(mix(scanner, sweep), attack=0.01, hold=0.25, curve=2.0)


def push():
    """Push back: a rising whoosh that shoves the swarm away."""
    air = swell(high_pass(noise(0.5, 11), 900))
    tone = gain(osc(0.5, 180, 900, "triangle"), 0.55)
    return envelope(mix(air, tone), attack=0.08, hold=0.25, curve=1.5)


def saucer():
    """Bonus saucer: a looping siren, built from whole wobbles so it seams."""
    return gain(warble(1.2, 720, 260, 5.0), 0.8)


def saucer_die():
    """Saucer shot down: a tumbling descent with a small boom."""
    tumble = sequence([1200, 1000, 820, 660, 520], 0.07, duty=0.3)
    boom = envelope(gain(low_pass(noise(0.35, 12), 1500), 0.8),
                    attack=0.002, curve=2.0)
    return mix(tumble, boom)


def dive():
    """An invader breaking formation: a falling screech."""
    scream = osc(0.75, 1400, 260, "saw")
    wobble = gain(osc(0.75, 60, 25, "sine"), 0.3)
    return envelope(mix(scream, wobble), attack=0.02, hold=0.1, curve=1.6)


def wave_clear():
    """Wave cleared: a five-note climb."""
    return sequence([523, 659, 784, 1047, 1319], 0.1, duty=0.45)


def level_start():
    """New level: a short three-note fanfare."""
    return sequence([392, 523, 659], 0.11, duty=0.5)


def game_over():
    """Game over: four sinking notes over a dying drone."""
    tune = sequence([440, 349, 294, 220], 0.26, "triangle", curve=1.6)
    drone = envelope(gain(osc(len(tune) / float(RATE), 120, 55, "saw"), 0.32),
                     attack=0.02, hold=0.4, curve=1.4)
    return mix(tune, drone)


#  The marching heartbeat: four low notes played in a loop, speeding up as the
#  swarm thins out.
MARCH_NOTES = [110, 98, 87, 78]


def march(freq):
    return envelope(osc(0.11, freq, freq * 0.92, "square"),
                    attack=0.004, hold=0.05, curve=2.0)


# --------------------------------------------------------------------------- #
def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    effects = [
        ("sfx_shoot.wav", shoot),
        ("sfx_laser.wav", laser),
        ("sfx_invader_die.wav", invader_die),
        ("sfx_armour_hit.wav", armour_hit),
        ("sfx_shield_hit.wav", shield_hit),
        ("sfx_player_hit.wav", player_hit),
        ("sfx_nuke.wav", nuke),
        ("sfx_powerup.wav", powerup),
        ("sfx_extra_life.wav", extra_life),
        ("sfx_force_field.wav", force_field),
        ("sfx_spark.wav", spark),
        ("sfx_scramble.wav", scramble),
        ("sfx_push.wav", push),
        ("sfx_saucer.wav", saucer),
        ("sfx_saucer_die.wav", saucer_die),
        ("sfx_dive.wav", dive),
        ("sfx_wave_clear.wav", wave_clear),
        ("sfx_level_start.wav", level_start),
        ("sfx_game_over.wav", game_over),
    ]

    for name, build in effects:
        save(build(), name)

    for index, freq in enumerate(MARCH_NOTES):
        save(march(freq), "sfx_march_{}.wav".format(index))

    print("\nSounds written to: {}".format(OUT_DIR))


if __name__ == "__main__":
    main()
