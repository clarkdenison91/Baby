# Baby Log!

A simple newborn tracker in the spirit of Huckleberry, styled like a 90s Saturday-morning cartoon. It is a static web page with no build step, no server and no account.

## What it tracks

- **Sleep**: tap Sleep to start a timer, tap Wake up to stop it.
- **Feeds**: breastfeeding with a Left/Right timer (pause or switch sides; it suggests the side to start on next), or a bottle with an amount in oz or ml, formula or breast milk.
- **Diapers**: wet, dirty or both, with an optional note.
- **Today view**: totals for the day, "last fed / last diaper / awake for" status, and an editable log. Use the arrows to look at earlier days.
- **Week view**: a 24-hour chart of sleep, feeds and diapers for the last 7 days, plus daily totals and averages.
- **Setup**: baby's name and birthday (shows age), oz/ml, light/dark/auto theme, export/import a JSON backup.

You can add or fix past entries with **+ Add past entry** or by tapping any item in the log. Timers keep running if you close the app or lock the phone.

## Where the data lives

Everything is saved in the browser's local storage on the device you use. Nothing is sent anywhere. Two consequences:

- Data does not sync between phones. Use **Setup → Export backup** and **Import backup** to move it.
- Clearing site data in the browser erases the log, so export a backup now and then.

## Running it

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

### Putting it on your phone

1. Push this repo to GitHub and turn on **Settings → Pages → Deploy from branch** for the branch you want.
2. Open the Pages URL on your phone.
3. Use **Share → Add to Home Screen** (iPhone) or **Install app** (Android). It then opens full-screen and works offline.

## Files

- `index.html`: page shell
- `styles.css`: the look (light "Saturday morning" theme and a dark "late-night" theme for 3 a.m. feeds)
- `app.js`: all logic and rendering
- `sw.js`, `manifest.webmanifest`, `icon.svg`: offline support and home-screen install
