# FussballGenie.de — Hugo Setup

Bundesliga News Site mit Live-Tabelle, Dark Mode, Liga-Filter und KI-Redakteur.

---

## Schnellstart (5 Minuten)

### 1. Hugo installieren (Mac)
```
brew install hugo
```

### 2. Diesen Ordner als Hugo-Projekt nutzen
```
cd bundesliga-hugo
hugo server
```
→ Öffne http://localhost:1313 im Browser

### 3. Für GitHub Pages bauen
```
hugo --minify
```
→ Alle Dateien landen im `public/` Ordner
→ Den `public/` Inhalt in dein GitHub Repo pushen

---

## Projektstruktur

```
bundesliga-hugo/
│
├── config.toml              ← Konfiguration (baseURL anpassen!)
│
├── layouts/
│   ├── _default/
│   │   ├── baseof.html      ← Haupt-Template (Wrapper für alle Seiten)
│   │   └── single.html      ← Einzelner Artikel
│   ├── partials/
│   │   ├── head.html        ← <head> Tag
│   │   ├── header.html      ← Navigation + Logo
│   │   ├── footer.html      ← Footer
│   │   ├── ticker.html      ← Live-Ticker oben
│   │   └── scores-bar.html  ← Ergebnisleiste
│   ├── page/
│   │   ├── hot.html         ← Hot-Seite Layout
│   │   ├── tabelle.html     ← Live-Tabelle Layout
│   │   └── wir.html         ← Über uns Layout
│   └── index.html           ← Startseite Layout
│
├── static/
│   ├── css/style.css        ← Komplettes CSS (Dark Mode, alle Komponenten)
│   └── js/
│       ├── main.js          ← Navigation, Filter, Dark Mode, Search
│       └── tabelle.js       ← Live OpenLigaDB API Widget
│
├── content/
│   ├── _index.md            ← Startseite Content
│   ├── hot.md               ← Hot-Seite
│   ├── tabelle.md           ← Tabellen-Seite
│   ├── wir.md               ← Über uns Seite
│   └── artikel/             ← Alle Artikel hier ablegen
│       ├── kane-sieg-klassiker.md
│       └── hsv-schlaegt-nuernberg.md
│
└── archetypes/
    └── artikel.md           ← Template für neue Artikel
```

---

## Neuen Artikel erstellen

### Option A — Hugo CLI (empfohlen)
```
hugo new artikel/mein-artikel-titel.md
```
→ Erstellt automatisch eine neue Datei mit allen Front Matter Feldern

### Option B — Datei manuell anlegen
Kopiere `archetypes/artikel.md` nach `content/artikel/` und passe an.

### Front Matter Felder erklärt
```yaml
---
title: "GROSSBUCHSTABEN HEADLINE"
date: 2026-03-17T20:41:00+01:00
draft: false                          # true = nicht veröffentlicht
liga: "1. Bundesliga"                 # Für den Liga-Filter
cat_class: "c-bl"                     # CSS Klasse für Kategorie-Farbe
cd_class: "cd-bl"                     # CSS Klasse für Kategorie-Punkt
teaser: "Kurzer Teaser max 160 Zeichen"
lesezeit: "3"
neu: true                             # Zeigt NEU-Badge an
gradient: "linear-gradient(135deg,#1a1a2e,#16213e)"  # Bild-Placeholder
author: "Max Müller"
---
```

### Kategorie CSS-Klassen
| Liga / Typ       | cat_class | cd_class  |
|------------------|-----------|-----------|
| 1. Bundesliga    | c-bl      | cd-bl     |
| 2. Bundesliga    | c-2bl     | cd-2bl    |
| Champions League | c-cl      | cd-cl     |
| Transfer         | c-tr      | cd-tr     |
| Analyse/Meinung  | c-me      | cd-me     |
| Standard (Rot)   | c-def     | cd-def    |

---

## GitHub Pages Deployment

### 1. config.toml anpassen
```toml
baseURL = "https://SnickersDE.github.io/Fussballgenie.de/"
```

### 2. GitHub Actions einrichten (automatisches Deployment)
Erstelle `.github/workflows/deploy.yml`:

```yaml
name: Deploy Hugo Site

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Hugo
        uses: peaceiris/actions-hugo@v3
        with:
          hugo-version: 'latest'
          extended: true
      - name: Build
        run: hugo --minify
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./public
```

→ Bei jedem `git push` wird die Site automatisch gebaut und deployed!

### 3. GitHub Pages aktivieren
Repository → Settings → Pages → Branch: `gh-pages`

---

## Custom Domain einrichten

### 1. CNAME Datei erstellen
```
echo "fussballgenie.de" > static/CNAME
```
(Die CNAME Datei muss in `static/` liegen, damit Hugo sie ins `public/` kopiert)

### 2. DNS beim Domain-Anbieter
```
A     @    185.199.108.153
A     @    185.199.109.153
A     @    185.199.110.153
A     @    185.199.111.153
CNAME www  dein-username.github.io
```

### 3. config.toml
```toml
baseURL = "https://zeitdassichwasdreht.de/"
```

---

## KI-Redakteur Integration

Der Python-Redakteur (`redakteur.py`) schreibt Artikel direkt als
Markdown-Dateien in `content/artikel/`. Hugo baut sie automatisch beim
nächsten Deploy mit ein.

### redakteur.py anpassen
```python
# Pfad zum Hugo content/artikel Ordner
ARTIKEL_ORDNER = "/pfad/zu/bundesliga-hugo/content/artikel"
```

Der Artikel wird als `.md` Datei mit korrektem Front Matter gespeichert
und beim nächsten `git push` automatisch über GitHub Actions deployed.

---

## Live-Tabelle

Die Tabelle auf `/tabelle/` lädt automatisch von der **OpenLigaDB API**
(kostenlos, kein API-Key). Funktioniert sobald die Site auf einem
echten Server/GitHub Pages läuft.

Liga wechseln: `/tabelle/?liga=bl1` oder `/tabelle/?liga=bl2`

---

## Liga-Filter auf der Startseite

Artikel werden gefiltert über URL-Parameter:
- `/` → Alle Artikel
- `/?liga=1bl` → Nur 1. Bundesliga
- `/?liga=2bl` → Nur 2. Bundesliga

Der Filter greift auf `data-league` und `data-title` Attribute der Cards zu.
Damit der KI-Redakteur-Artikel gefiltert wird, muss der Titel oder
die Liga den Begriff "1. Bundesliga" oder "2. Bundesliga" enthalten.

---

## Troubleshooting

**Hugo kennt das Layout nicht**
→ Prüfe ob der `layout:` Wert in der `.md` Datei mit dem Dateinamen
  in `layouts/page/` übereinstimmt.

**Tabelle lädt nicht lokal**
→ CORS blockiert lokale API-Anfragen. Auf GitHub Pages funktioniert
  es sofort.

**Artikel erscheinen nicht auf der Startseite**
→ `draft: false` setzen und `hugo server -D` ausführen (zeigt auch Drafts).

**CSS-Änderungen werden nicht angezeigt**
→ Browser-Cache leeren (CMD+SHIFT+R) oder Hugo neu starten.
