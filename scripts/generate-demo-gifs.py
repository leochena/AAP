from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "demos"
WIDTH = 860
HEIGHT = 484
BG = "#08111f"
PANEL = "#0f1f33"
PANEL_2 = "#10293d"
TEXT = "#e5f7ff"
MUTED = "#9fb3c8"
CYAN = "#22d3ee"
GREEN = "#34d399"
YELLOW = "#facc15"
RED = "#fb7185"
PURPLE = "#c4b5fd"


def load_font(name: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts") / name,
        Path("/usr/share/fonts/truetype/dejavu") / name,
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


FONT = load_font("segoeui.ttf", 18)
FONT_BOLD = load_font("seguisb.ttf", 18)
FONT_TITLE = load_font("seguisb.ttf", 31)
FONT_MONO = load_font("consola.ttf", 17)
FONT_MONO_BOLD = load_font("consolab.ttf", 17)
FONT_SMALL = load_font("segoeui.ttf", 14)


DEMOS = [
    {
        "file": "world-cup-result.gif",
        "title": "World Cup Result Adversarial Run",
        "prompt": "Who won the 2022 FIFA World Cup?",
        "lines": [
            ("deepseek", "Argentina won the final, but reports 2-1."),
            ("qwen", "Final was Argentina vs France; went to penalties."),
            ("tool", "search('2022 FIFA World Cup final result') -> FIFA match page"),
            ("challenge", "Score mismatch: regulation 2-2; after extra time 3-3."),
            ("revision", "Corrected answer: Argentina 3-3 France, 4-2 on pens."),
            ("vote", "Consensus: Argentina won the 2022 FIFA World Cup."),
        ],
        "result": "Final: verified result, wrong score corrected before vote.",
    },
    {
        "file": "code-understanding.gif",
        "title": "Code Understanding Adversarial Run",
        "prompt": "Explain this retry(fn, {times, signal}) helper.",
        "lines": [
            ("model-a", "It retries an async task and returns the first success."),
            ("model-b", "It also listens to AbortSignal before each attempt."),
            ("challenge", "Missing detail: delay grows after every failed attempt."),
            ("tool", "exec_python('simulate backoff schedule') -> 100, 200, 400 ms"),
            ("revision", "Summary includes retry count, abort path, and backoff."),
            ("vote", "Winner: answer that explains behavior and edge cases."),
        ],
        "result": "Final: implementation intent + edge cases, not just a paraphrase.",
    },
    {
        "file": "question-verification.gif",
        "title": "Question Verification Adversarial Run",
        "prompt": "Is 97 a prime number? Verify instead of guessing.",
        "lines": [
            ("model-a", "97 is prime, but gives no verification."),
            ("model-b", "Need test divisors up to floor(sqrt(97)) = 9."),
            ("tool", "exec_python('divisors of 97 from 2..9') -> []"),
            ("challenge", "Claim is accepted only after divisor-bound check."),
            ("revision", "No divisors 2,3,4,5,6,7,8,9; 97 is prime."),
            ("vote", "Verified consensus; evidence is visible in tool log."),
        ],
        "result": "Final: small factual claim verified by an explicit tool trace.",
    },
    {
        "file": "standards-interpretation.gif",
        "title": "Standards Interpretation Adversarial Run",
        "prompt": "Is 2026-05-21T09:30:00+08:00 valid RFC 3339?",
        "lines": [
            ("model-a", "Says yes because it looks like ISO 8601."),
            ("model-b", "Checks profile details: date, time, offset, separator."),
            ("tool", "fetch_url('RFC 3339') -> date-time grammar excerpt"),
            ("challenge", "Do not equate all ISO 8601 strings with RFC 3339."),
            ("revision", "This string fits RFC 3339 date-time with numeric offset."),
            ("vote", "Consensus with caveat: strict profile, not all ISO forms."),
        ],
        "result": "Final: standard-specific answer with the caveat preserved.",
    },
]


def draw_rounded(draw: ImageDraw.ImageDraw, xy: tuple[int, int, int, int], fill: str, outline: str | None = None) -> None:
    draw.rounded_rectangle(xy, radius=18, fill=fill, outline=outline, width=1 if outline else 0)


def draw_text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fill: str, font: ImageFont.ImageFont) -> None:
    draw.text(xy, text, fill=fill, font=font)


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    fill: str,
    font: ImageFont.ImageFont,
    max_width: int,
    line_gap: int = 5,
) -> int:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=font)[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)

    x, y = xy
    for line in lines:
        draw_text(draw, (x, y), line, fill, font)
        y += font.size + line_gap
    return y


def phase_color(index: int, visible_lines: int) -> str:
    if visible_lines <= 2:
        active = 0
    elif visible_lines <= 3:
        active = 1
    elif visible_lines <= 5:
        active = 2
    else:
        active = 3
    return GREEN if index <= active else "#2a405c"


def line_color(kind: str) -> str:
    if kind == "tool":
        return CYAN
    if kind == "challenge":
        return YELLOW
    if kind == "revision":
        return PURPLE
    if kind == "vote":
        return GREEN
    if kind.startswith("model") or kind in {"deepseek", "qwen"}:
        return "#93c5fd"
    return MUTED


def render_frame(demo: dict, visible_lines: int, cursor_on: bool) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)

    draw_rounded(draw, (26, 24, WIDTH - 26, HEIGHT - 24), PANEL, "#233b56")
    draw.rounded_rectangle((26, 24, WIDTH - 26, 70), radius=18, fill="#0b1828")
    draw.rectangle((26, 52, WIDTH - 26, 70), fill="#0b1828")
    for i, color in enumerate([RED, YELLOW, GREEN]):
        draw.ellipse((52 + i * 24, 43, 64 + i * 24, 55), fill=color)

    draw_text(draw, (52, 100), demo["title"], TEXT, FONT_TITLE)
    y = draw_wrapped(draw, (52, 142), f"Prompt: {demo['prompt']}", "#b8cbe0", FONT, 742)

    phases = ["Generate", "Ground", "Challenge", "Vote"]
    x = 52
    y += 20
    for i, phase in enumerate(phases):
        color = phase_color(i, visible_lines)
        draw.rounded_rectangle((x, y, x + 150, y + 32), radius=16, fill=color)
        label_w = draw.textbbox((0, 0), phase, font=FONT_BOLD)[2]
        draw_text(draw, (x + (150 - label_w) // 2, y + 5), phase, "#06111f", FONT_BOLD)
        if i < len(phases) - 1:
            draw.line((x + 156, y + 16, x + 184, y + 16), fill="#42617e", width=3)
        x += 188

    transcript_top = y + 54
    draw_rounded(draw, (52, transcript_top, WIDTH - 52, HEIGHT - 88), PANEL_2, "#254965")
    draw_text(draw, (76, transcript_top + 18), "AAP run trace", "#a7c2d9", FONT_SMALL)

    line_y = transcript_top + 48
    for kind, text in demo["lines"][:visible_lines]:
        color = line_color(kind)
        draw_text(draw, (76, line_y), f"{kind:>9}", color, FONT_MONO_BOLD)
        line_y = draw_wrapped(draw, (178, line_y), text, "#d9e7f5", FONT_MONO, 606, 4)
        line_y += 7

    if cursor_on and visible_lines < len(demo["lines"]):
        draw.rectangle((76, line_y + 4, 86, line_y + 20), fill=GREEN)

    draw_rounded(draw, (52, HEIGHT - 72, WIDTH - 52, HEIGHT - 40), "#0d1b2d", "#254965")
    draw_text(draw, (76, HEIGHT - 64), demo["result"], "#d7fbe8", FONT_SMALL)

    return image


def frames_for(demo: dict) -> Iterable[Image.Image]:
    total = len(demo["lines"])
    for visible in range(0, total + 1):
        yield render_frame(demo, visible, cursor_on=True)
        yield render_frame(demo, visible, cursor_on=False)
    for _ in range(8):
        yield render_frame(demo, total, cursor_on=False)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for demo in DEMOS:
        frames = list(frames_for(demo))
        output = OUT_DIR / demo["file"]
        frames[0].save(
            output,
            save_all=True,
            append_images=frames[1:],
            duration=160,
            loop=0,
            optimize=True,
            disposal=2,
        )
        print(f"wrote {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
