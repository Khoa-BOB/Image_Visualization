# Image Visualization

An interactive OME-Zarr image viewer built with [Viv](https://github.com/hms-dbmi/viv) and [deck.gl](https://deck.gl/). Supports multiscale image rendering, freehand annotation, and text labels.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/)

## Setup

```bash
pnpm install
```

## Serve the data via nginx

The viewer expects a DZI file at `http://localhost:8080/dzi/`. Add the following block to your nginx config:

```nginx
server {
    listen 8080;
    server_name localhost;

    location /dzi/ {
        alias /path/to/your/zarr/; # example: /Users/../../mosaic.ome.zarr/
        autoindex on;
        add_header Access-Control-Allow-Origin * always;
    }
}
```

Your mosaic.ome.zarr folder should look like:

```
mosaic.ome.zarr/
├── .zattrs
├── .zgroup
└── 0/
    ├── .zarray
    └── 0/
        └── 0/
            └── 0
```

Reload nginx after editing the config:

```bash
nginx -s reload
```

Update `OME_ZARR_URL` in `src/main.js` to point to your DZI file, e.g. `http://localhost:8080/zarr/`.

## Run

```bash
pnpm dev
```

Open `http://localhost:5173` in your browser.

## Usage

| Button | Action |
|--------|--------|
| **Pan / Zoom** | Click and drag to pan; scroll to zoom |
| **Draw** | Click and drag to draw freehand lines |
| **Clear Lines** | Remove all drawn annotations |

## Build

```bash
pnpm build
```

Output is written to `dist/`.
