# Lingua

A Chrome extension that translates English PDFs into natural Persian, displayed in a split-view alongside the original text.

## Features

- Split-view reader: original PDF on the left, Persian translation on the right
- On-demand page-by-page translation via Google Gemini API
- Natural and technical translation modes
- Customizable font size, line height, and opacity
- Light, dark, and system theme support
- Translation caching for faster reloads
- Bidirectional text handling with Vazirmatn font

## Requirements

- Google Chrome (Manifest V3 compatible)
- A Google Gemini API key ([Get one here](https://aistudio.google.com/apikey))

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Build the extension:
   ```
   npm run build
   ```
4. Open Chrome and navigate to `chrome://extensions`
5. Enable **Developer mode**
6. Click **Load unpacked** and select the `dist` folder
7. Click the Lingua icon in the toolbar, go to **Settings**, and enter your Gemini API key

## Usage

1. Open a PDF file in Chrome (or navigate to a URL ending in `.pdf`)
2. Click the **Lingua** extension icon
3. Toggle **Translation** on
4. Click **Translate PDF** to open the split-view reader
5. Use the **Translate** button in the toolbar to translate the current page

## Development

```
npm run dev        # Build in watch mode
npm run build      # Production build
npm run typecheck  # Type checking
npm run lint       # Linting
```
