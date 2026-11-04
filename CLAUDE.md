# Nutrition — maintenance notes

Static installable web app (PWA) served by GitHub Pages from the `gh-pages` branch
(https://jtnicastro.github.io/nutrition/). `main` holds the same files; push both.

- `index.html` / `app.js` / `app.css`: the whole app (vanilla JS, no build step).
- The plan and saved copies live only in the phone's localStorage under `nutrition-app-v1`
  (`{ v, plan, copies, settings, backedUpAt }`). Never rename that key or change the plan/food shape
  without a migration, or installed copies lose data. Plan shape is documented in the Nutrition
  project doc `claude/nutrition-app.md`.
- `seed.json` is only read on first launch (empty storage). Changing it does not touch installed copies.
- After changing any shipped file run `python3 tools/build.py sw` so installed apps see an update.
