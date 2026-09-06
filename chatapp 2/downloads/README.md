# Desktop app downloads

Drop your built installer files here, using these exact names, and the
`/download` page on your site will automatically pick them up:

- `The-Room-Setup.exe` — the Windows installer (built via `npm run
  dist:win` in the desktop app project, found afterward in its `dist`
  folder — rename it to match exactly).
- `The-Room.dmg` — the Mac installer (built via `npm run dist:mac`,
  same idea — rename the output to match exactly).

You don't need both — if only one exists, the download page shows
"coming soon" for the other and a working button for the one that does.

## After adding a file

1. Commit and push it to your GitHub repo (the same `chatapp2` folder as
   everything else), inside this `downloads` folder.
2. Render will redeploy automatically.
3. Visit `https://your-app.onrender.com/download` to confirm the button
   works.

## A note on file size

Installer files are usually 60–90MB (Electron bundles a full browser
engine). GitHub allows files up to 100MB, so this should fit, but it
does make your repo noticeably larger and slightly slows down every
future `git push`/`git pull`. That's normal and expected — nothing to
worry about, just don't be surprised by it.
