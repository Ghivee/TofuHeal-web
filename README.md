# Tofu-Heal

A single-page web app that estimates the pH of a wound from a photo of a curcumin sensor. Curcumin changes colour with pH. The app captures the sensor through the camera, normalises the colour against the lighting, maps the hue to a pH between 4 and 10 and classifies the result (for example normal or warning).

[Bahasa Indonesia](README.id.md)

This is a research prototype. It is not a medical device and does not replace advice from a clinician.

## What it does

- Camera capture with a stencil, and RGB calibration shown as metrics.
- Colour processing in `script.js`: illuminant-normalised hue (white-reference correction toward D65), extreme-pixel filtering and a hue-to-pH mapping.
- A status label with a confidence value, and an error when the colour is too faded to analyse.
- An analysis history stored in `localStorage`, with a button to clear it.

## Tech stack

Plain HTML, CSS and JavaScript with the Canvas API and `getUserMedia`. Lucide icons are loaded from a CDN. No build step; `index.html` is the entry point and the app runs on GitHub Pages.

## Running it

Serve the folder over HTTP (the camera needs a secure context):

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`.
