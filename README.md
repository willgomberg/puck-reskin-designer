# Puck Reskin Designer

<div align="center">

**An easy-to-use editor for creating and using custom rink reskins for [Puck](https://store.steampowered.com/app/2994020/Puck/), a popular first-person hockey video game.**

<img width="700" alt="Puck Reskin Designer - GIF Demo" src="https://github.com/user-attachments/assets/ffef3c00-c9a1-4602-89ee-04c7c571c24c" />

</div>

<br>

> <ins>Note:</ins> Using reskins in-game requires [Toaster's Reskin Loader](https://steamcommunity.com/workshop/filedetails/?id=3497550964) mod; this is what allows you to actually select your reskins for use.

## Features

- Create custom rink reskins by changing colors, applying gradients, or adjusting the visibility of elements on the ice.
- Add your own logo onto the ice via PNG graphic overlays.
- Use Presets if you want an even faster way to create custom rinks.
- Save your projects so that you can return to the editor later and pick up where you left off.
- Export your new rinks for use directly in Puck, quickly and simply.

## Getting started (for users)

### Download and install

Go to the **[latest release](https://github.com/willgomberg/puck-reskin-designer/releases/latest)** and expand **Assets** to find the correct download for your OS.

<details open>
<summary><b>Windows (x64)</b></summary>

1. Download the installer ending in `-win-x64.exe` and open it.
2. If Windows SmartScreen shows **Windows protected your PC**, choose **More info → Run anyway**. 

    <details>
    <summary>How to bypass SmartScreen</summary>
        
    <img height="250" alt="Bypass SmartScreen (Windows) - Puck Reskin Designer" src="https://github.com/user-attachments/assets/c71b5d05-959c-4a0a-a615-0e908ef7bf77" />

    </details>
   
</details>

<details>
<summary><b>macOS</b></summary>


1. Download the DMG ending in `-mac-universal.dmg`, which supports both **Apple silicon (M1 or later)** and **Intel Macs**.
2. Open the DMG, drag **Puck Reskin Designer** to **Applications**, then eject the DMG from Finder.
3. Open the app from your Applications. If macOS blocks it because the developer cannot be verified, dismiss the warning by clicking "OK" or whatever other option exists (**do not "Move to Trash"**).
4. Open **System Settings → Privacy & Security**. Scroll down to **Security** and click **Open Anyway** beside the message about Puck Reskin Designer. Confirm the next prompt with **Open Anyway** or **Open**, as shown, if you trust the download. Authenticate if asked. **You can then open the app normally each time.** macOS may ask again only if you install a future app update.

As this project did not pay Apple to sign / notarize, the steps above follow [Apple's instructions for opening an app from an unidentified developer](https://support.apple.com/en-ca/102445).

</details>

> **About OS warnings:** This is an independent, non-commercial hobby project. Since 'code signing' is expensive (a few hundred dollars for Windows + macOS), the installers are not signed, which is what causes these warnings, as you often see with small open source projects. If you would like, you can choose to scan the downloaded installer with [VirusTotal](https://www.virustotal.com/gui/home/upload).

### Using the app

1. **Select rink elements.** Choose a layer or expand it to select individual elements. Use the checkboxes or **Ctrl + Click** (⌘ + Click on Mac) to select multiple elements.

2. **Customize the rink.** Edit the appearance of selected elements via **Properties**, then click **Apply to selection** to keep the previewed edits. Alternatively, **Presets** are a quick way to get a customized rink in just a few clicks; you simply fill in the 3 required colors, click **Apply preset**, and it generates a fully customized rink.

3. **Add a logo or graphic (optional).** Select **Add graphic overlay** to import a PNG, adjust how it appears on the ice, and click **Apply changes**. Make sure the PNG resolution is not too small; ideally at least 1200px on it's longest side.

4. **Save your project.** Use **Save** to create an editable `.rskn` file you can reopen later. Saving a project does **not** export it to Puck.

5. **Export PNG to use in-game.** Select **Export PNG** and <ins>choose one of the following export options</ins>:
    - a) **Export to Puck for easy in-game use (*recommended*)**
        - First, if you haven't already, **install [Toaster's Reskin Loader (TRL)](https://steamcommunity.com/workshop/filedetails/?id=3497550964) Steam Workshop mod**, and then **enable the mod in-game via the mods menu.** **Do this before proceeding with the rest of the export.**
        - With TRL enabled, from my app's export screen, **name your rink**, **create a reskin pack or add it to an existing one**, and **Export**. In-game, **open Reskin Manager** from the main menu, go to **Arena** tab, and select your new ice reskin from the **ice** selector.
    
    - b) **Save PNG elsewhere** - Export a standalone rink PNG to your computer if you prefer to handle the process of adding it to the game yourself (or if you're using the editor on a computer that does not have Puck installed). For the manual process of creating reskin packs, see Toaster's [reskin pack guide](https://github.com/ckhawks/ToastersReskinLoader/wiki/Making-a-Reskin-Pack-with-Toaster's-Reskin-Loader).

### Updates and help

Use **Help → Check for Updates…** to check for a newer stable release and open its download page. If a newer version is available, note that you will have to install it manually via the same process as initial install (go to the latest GitHub release...).

For bugs or suggestions, [open an issue](https://github.com/willgomberg/puck-reskin-designer/issues).

## For developers

### Install and run

Make sure you have **Node.js 24 (with npm)** and **Git**, then run:

```sh
git clone https://github.com/willgomberg/puck-reskin-designer.git
cd puck-reskin-designer
npm ci
npm start
```

`npm ci` installs the locked dependencies. `npm start` builds the renderer and launches Electron.

### Useful commands

| Command | Result |
| --- | --- |
| `npm start` | Build the renderer and launch the Electron app (quickest way to run the app) |
| `npm run dev` | Vite browser preview; more limited web version, as native file dialogs & desktop integration require Electron |
| `npm test` | Run automated tests |
| `npm run build` | Build the renderer into `dist/` |
| `npm run package` | Build an unpacked desktop app into `out/` |
| `npm run dist:win` | Build the Windows x64 NSIS installer into `out/` |
| `npm run dist:mac` | Build one universal macOS DMG for Apple silicon and Intel into `out/` |

Build Windows installers on Windows and macOS DMGs on macOS. Packaging commands create local output without installing or publishing it. The current configuration produces unsigned Windows installers and ad-hoc signed, unnotarized Mac apps.

### Project structure

The app uses HTML, CSS, vanilla JavaScript, Vite, Electron, and electron-builder. The editor runs in the renderer; native operations go through preload to the main process. The file tree below displays the repository structure at a glance. Not every single module is mentioned here.


```text

├── src/
│   ├── main/                       # Electron main process
│   │   ├── main.js                 # Electron startup and window security
│   │   ├── game-detection.js       # Finds or validates Puck installation folder
│   │   ├── reskin-pack.js          # Read & write local reskin packs
│   │   └── …
│   ├── renderer/                   # Renderer process (app's logic & UI)
│   │   ├── app.js                  # Main coordinator of editor & UI lifecycle
│   │   ├── editor-state.js         # Plain data / design state
│   │   ├── svg-operations.js       # Updates the actual visible SVG nodes & visible graphic
│   │   ├── layer-definitions.js    # Static rink layer definitions and SVG node mappings
│   │   ├── icons/              
│   │   ├── ui/                     # Inspector, layer browser, dialogs, and viewport logic
│   │   │   └── …
│   │   └── …
│   └── preload.js                  # Narrow bridge to desktop operations
├── test/                           # Automated behavior and validation tests
├── build/                          # Windows & macOS app icon assets
├── index.html                      # Editor interface markup
├── Rink SVG Template.svg           # Source rink template used by the editor
├── package.json                    # Metadata and npm scripts
└── …
```

`dist/` (renderer build) and `out/` (packages and installers) are generated and excluded from Git. Note that much of the editor's logic requires the rink template SVG and the layer definitions to remain unchanged. Changing them would require changing all relevant logic associated with them.

Note that while test modules are helpful for basic checks, they are not necessarily fully comprehensive. All tests passing does not guarantee that modifications you make to the codebase do not have unexpected behaviors.

## Roadmap and planned features

- Additional rink customization options
    - Adjust the thickness of the lines, faceoff circles, etc.
    - Dashed line options
    - Further control over gradients (offsets / stops, more than 2 colors, etc.)
    - Custom textures for rink elements
- Better graphic overlay controls & options
    - Ability to directly drag logo / graphic via the canvas, smart snapping
    - Ability to add more than 1 custom graphic
- In-app library panel with saved colors & gradients, to make it easier to reuse them or apply them across different projects
- Ability to preview how rink would look in-game during the editing process, without needing to click export.

## License and acknowledgments

Puck Reskin Designer is licensed under the [MIT License](LICENSE). Third-party assets (external icons) retain their own license. This is an independent community project and is not affiliated with or endorsed by the developers of Puck, Toaster, or Toaster's Reskin Loader.

The interface uses icons from [Lucide](https://lucide.dev/), including icons derived from [Feather](https://feathericons.com/), under the ISC and MIT licenses.

<details>
<summary>Icon license notices</summary>

The applicable notices from [Lucide's license](https://github.com/lucide-icons/lucide/blob/main/LICENSE) follow.

### Lucide — ISC License

```text
Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.
THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### Feather-derived icons — MIT License

```text
Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>
