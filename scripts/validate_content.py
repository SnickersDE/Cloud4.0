from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
ARTICLES_DIR = ROOT / "content" / "artikel"


def frontmatter_block(text: str) -> str:
    if not text.startswith("---"):
        return ""
    parts = text.split("---", 2)
    if len(parts) < 3:
        return ""
    return parts[1]


def has_list_value(block: str, key: str) -> bool:
    pattern_inline = re.compile(rf"^{key}\s*:\s*\[.+\]\s*$", re.MULTILINE)
    if pattern_inline.search(block):
        return True
    pattern_key = re.compile(rf"^{key}\s*:\s*$", re.MULTILINE)
    m = pattern_key.search(block)
    if not m:
        return False
    rest = block[m.end():]
    return bool(re.search(r"^\s*-\s+\S+", rest, re.MULTILINE))


def has_scalar(block: str, key: str) -> bool:
    pattern = re.compile(rf"^{key}\s*:\s*.+$", re.MULTILINE)
    return bool(pattern.search(block))


def extract_key_segment(block: str, key: str) -> str:
    lines = block.splitlines()
    out = []
    capture = False
    for line in lines:
        if re.match(rf"^{key}\s*:", line):
            capture = True
            out.append(line)
            continue
        if capture and re.match(r"^[A-Za-z_]+\s*:", line):
            break
        if capture:
            out.append(line)
    return "\n".join(out)


def validate_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    block = frontmatter_block(text)
    errors: list[str] = []
    if not block:
        return [f"{path}: Front Matter fehlt oder ist ungültig"]
    for scalar in ("slug", "liga", "teaser", "author"):
        if not has_scalar(block, scalar):
            errors.append(f"{path}: Pflichtfeld '{scalar}' fehlt")
    for arr in ("categories", "tags"):
        if not has_list_value(block, arr):
            errors.append(f"{path}: Pflichtliste '{arr}' fehlt oder ist leer")
    tags_segment = extract_key_segment(block, "tags")
    if "team:" not in tags_segment:
        errors.append(f"{path}: mindestens ein team-Tag (team:...) fehlt")
    if "spieler:" not in tags_segment:
        errors.append(f"{path}: mindestens ein spieler-Tag (spieler:...) fehlt")
    if "liga:" not in tags_segment:
        errors.append(f"{path}: mindestens ein liga-Tag (liga:...) fehlt")
    return errors


def main() -> int:
    all_errors: list[str] = []
    for md in sorted(ARTICLES_DIR.glob("*.md")):
        all_errors.extend(validate_file(md))
    if all_errors:
        print("\n".join(all_errors))
        return 1
    print("Content validation passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
