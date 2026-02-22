// deck.gl core: Deck is the main rendering engine; OrthographicView provides a 2D top-down camera (no perspective distortion)
import { Deck, OrthographicView } from '@deck.gl/core'
// TextLayer renders text strings at arbitrary image-space positions
import { TextLayer } from '@deck.gl/layers'
// MultiscaleImageLayer renders a pyramid (multi-resolution) image using WebGL
import { MultiscaleImageLayer } from '@vivjs/layers'
// loadOmeZarr: fetches and parses an OME-Zarr file from a URL
// isInterleaved: checks if the pixel data is stored as interleaved RGB(A) (e.g. [R,G,B,R,G,B,...]) vs separate planes
// getChannelStats: computes per-channel min/max/mean statistics from raw pixel data
import { loadOmeZarr, isInterleaved, getChannelStats } from '@vivjs/loaders'
// DTYPE_VALUES maps dtype strings (e.g. 'Uint8', 'Uint16') to their numeric range info (min/max)
import { DTYPE_VALUES } from '@vivjs/constants'

// Builds the array of dimension selections for each requested channel index.
// A "selection" tells the loader which t/z/c slice to read from the n-dimensional array.
// baseSource: the highest-resolution PixelSource (pyramid[0])
// channelIndices: which channel indices to create selections for (e.g. [0, 1, 2])
function getSelectionsForChannels(baseSource, channelIndices = [0]) {
  const labels = baseSource.labels || []
  // Detect which dimensions exist in this dataset
  const hasC = labels.includes('c')
  const hasZ = labels.includes('z')
  const hasT = labels.includes('t')

  // For each requested channel, create a selection object with fixed t=0, z=0 (the first frame/slice)
  // and the specific channel index c. Dimensions that don't exist are omitted.
  return channelIndices.map((c) => {
    const sel = {}
    if (hasT) sel.t = 0  // pin to first time point
    if (hasZ) sel.z = 0  // pin to first Z-plane (no z-stack navigation)
    if (hasC) sel.c = c  // select this channel plane
    return sel
  })
}

// Returns the default contrast limits (display window) for n channels.
// Each entry is [min, max] mapped to the full dtype range so the image is visible immediately.
function getDefaultContrast(max, n) {
  // Use full range per channel by default
  return Array.from({ length: n }, () => [0, max])
}

// Returns a boolean array controlling which channels are rendered.
// Only the first 3 channels are visible by default to avoid an overwhelming initial view.
function getChannelsVisible(n) {
  // Show up to first 3 channels by default; others off
  return Array.from({ length: n }, (_, i) => i < 3)
}

// Returns RGB colors assigned to each channel for false-color rendering.
// Cycles through a 6-color palette if there are more than 6 channels.
function getDefaultColors(n) {
  const palette = [
    [255, 0, 0],    // R  – channel 0
    [0, 255, 0],    // G  – channel 1
    [0, 0, 255],    // B  – channel 2
    [0, 255, 255],  // C  – channel 3
    [255, 0, 255],  // M  – channel 4
    [255, 255, 0]   // Y  – channel 5
  ]
  // Wrap around the palette with modulo if there are more channels than palette entries
  return Array.from({ length: n }, (_, i) => palette[i % palette.length])
}

// Builds a TextLayer from an array of label objects: { position: [x, y], text: string }.
// Labels are positioned in image-pixel space and scale with zoom (sizeUnits: 'common').
// A semi-transparent black background is drawn behind each label for legibility.
function buildTextLayer(labels) {
  return new TextLayer({
    id: 'text-labels',
    data: labels,
    // x/y in image-pixel coordinates (same space as the OrthographicView camera)
    getPosition: (d) => [d.position[0], d.position[1], 0],
    getText: (d) => d.text,
    // 'common' units means the size is in coordinate (image-pixel) units, so text scales with zoom
    sizeUnits: 'common',
    getSize: 20,              // 20 image-pixels tall at native resolution
    getColor: [255, 255, 0],  // yellow text for contrast against dark/fluorescence images
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'center',
    fontWeight: 'bold',
    // Background pill behind each label
    background: true,
    getBackgroundColor: [0, 0, 0, 160],  // semi-transparent black
    backgroundPadding: [6, 3, 6, 3],     // [left, top, right, bottom] in the same units as getSize
  })
}

// Computes a deck.gl view state (camera position + zoom level) that fits the full image in the viewport.
// pyramid: array of PixelSource objects (highest → lowest resolution)
// viewWidth/viewHeight: size of the HTML container in pixels
// backoff: small zoom-out factor (0.25 stops) to add padding around the image edges
function computeInitialViewState(pyramid, viewWidth, viewHeight, backoff = 0.25) {
  const base = Array.isArray(pyramid) ? pyramid[0] : pyramid
  // Center on image and fit to view
  // Read physical pixel dimensions from the highest-resolution source's shape descriptor
  const width = base.shape[base.labels.indexOf('x')]
  const height = base.shape[base.labels.indexOf('y')]
  // zoom is in log2 scale: zoom=0 means 1 px per tile pixel; negative = zoomed out
  const zoom = Math.log2(Math.min(viewWidth / width, viewHeight / height)) - backoff
  return {
    target: [width / 2, height / 2, 0],  // pan camera to image center
    zoom
  }
}

// Main entry point: loads an OME-Zarr image and mounts an interactive deck.gl viewer into container.
// container: an HTMLElement (e.g. a <div>) where the WebGL canvas will be inserted
// omeZarrUrl: URL string pointing to an OME-Zarr store (local or remote)
// initialLabels: optional array of { position: [x, y], text: string } in image-pixel coordinates.
//   Defaults to three sample labels placed at the center, top-left, and bottom-right of the image.
export async function initVivDeck(container, omeZarrUrl, initialLabels = null) {
  if (!container) throw new Error('Missing container element')

  // Load OME-Zarr multiscale image
  // pyramid is an array of PixelSource objects ordered from highest to lowest resolution
  const { data: pyramid /* PixelSource[] */ } = await loadOmeZarr(omeZarrUrl, {
    type: 'multiscales'
  })

  const base = pyramid[0]                 // highest-resolution level
  const axisLabels = base.labels || []    // axis names, e.g. ['t','c','z','y','x']
  const cIndex = axisLabels.indexOf('c')

  // isInterleaved returns true when pixels are packed as [R,G,B,...] in the last axis
  // (common for standard PNG/TIFF RGB images stored in Zarr)
  const interleaved = isInterleaved(base.shape)

  // Determine the total number of channels in the dataset:
  // - Interleaved RGB has 3 components, RGBA has 4 (read from the last shape axis)
  // - Planar images have one shape entry per channel along the 'c' axis
  // - Fall back to 1 if there is no channel dimension
  const totalChannels = interleaved ? (base.shape[base.shape.length - 1] === 4 ? 4 : 3) : (cIndex >= 0 ? base.shape[cIndex] : 1)

  // Cap at 6 channels to match the default color palette length
  const maxChannels = Math.min(totalChannels, 6)

  // Build per-channel slice selections (skipped for interleaved data because the loader
  // reads all RGB components in a single call with an empty selection object)
  const selections = interleaved
    ? [{}] // RGB(A) bitmap path ignores channel selections
    : getSelectionsForChannels(base, Array.from({ length: maxChannels }, (_, i) => i))

  // Determine dtype max and compute reasonable contrast limits
  // dtype describes the numeric type stored in the Zarr (e.g. 'Uint8', 'Uint16', 'Float32')
  const dtype = base.dtype || 'Uint16'
  const dtypeInfo = DTYPE_VALUES[dtype] || DTYPE_VALUES.Uint16  // fallback to Uint16 range if unknown
  // Start with full-range contrast limits; will be overridden by stats below if possible
  let contrastLimits = interleaved
    ? []  // not used for interleaved images
    : getDefaultContrast(dtypeInfo.max, maxChannels)

  // Try to infer contrast limits from downsampled raster stats (best-effort)
  // Using the lowest-resolution pyramid level is fast and gives a good approximation
  if (!interleaved) {
    try {
      const lowRes = pyramid[pyramid.length - 1]  // smallest/fastest level to read
      // Fetch raster data for each channel selection concurrently
      const statsPromises = selections.map(async (sel) => {
        const { data } = await lowRes.getRaster({ selection: sel })
        // getChannelStats returns { contrastLimits: [min, max], ... } based on actual pixel values
        const { contrastLimits } = getChannelStats(Array.from(data))
        return contrastLimits
      })
      const stats = await Promise.all(statsPromises)
      contrastLimits = stats  // replace defaults with data-driven limits
    } catch (_) {
      // keep default contrast limits on failure
      // (e.g. network error, unsupported dtype, empty tile)
    }
  }

  // Set initial view state to fit
  // getBoundingClientRect gives the current rendered size of the container in CSS pixels
  const rect = container.getBoundingClientRect()
  const initialVS = computeInitialViewState(pyramid, Math.max(1, rect.width), Math.max(1, rect.height), 0.25)

  // Derive image pixel dimensions from the highest-resolution source for default label placement
  const imgWidth = base.shape[base.labels.indexOf('x')]
  const imgHeight = base.shape[base.labels.indexOf('y')]

  // If the caller did not supply labels, place three sample labels so something is visible immediately
  const labels = initialLabels ?? [
    { position: [imgWidth / 2,        imgHeight / 2       ], text: 'Center'       },
    { position: [imgWidth * 0.1,      imgHeight * 0.1     ], text: 'Top-Left'     },
    { position: [imgWidth * 0.9,      imgHeight * 0.9     ], text: 'Bottom-Right' },
  ]

  // Ensure the view has an id, since Viv layers use viewportId to sync
  // The viewId links the OrthographicView camera to the MultiscaleImageLayer so they stay in sync
  const viewId = 'detail'

  // Extract the image layer to a variable so setLabels can reference it without rebuilding it
  const imageLayer = new MultiscaleImageLayer({
    id: 'ome-zarr-layer',
    loader: pyramid,            // the full resolution pyramid for level-of-detail rendering
    selections: selections.length ? selections : [{}],  // which t/z/c slices to display
    contrastLimits,             // [min, max] display window per channel
    channelsVisible: interleaved ? [] : Array(maxChannels).fill(true),  // all channels on for planar images
    colors: interleaved ? undefined : getDefaultColors(maxChannels),    // false-color per channel (unused for RGB)
    viewportId: viewId          // must match the OrthographicView id above
  })

  const deck = new Deck({
    parent: container,  // deck.gl will create and append a <canvas> inside this element
    views: [new OrthographicView({ id: viewId, controller: true })],  // controller: true enables pan/zoom via mouse/touch
    initialViewState: { id: viewId, ...initialVS },
    // TextLayer is listed after imageLayer so it renders on top
    layers: [imageLayer, buildTextLayer(labels)]
  })

  // Handle container resize
  // ResizeObserver fires whenever the container element changes size (e.g. window resize, CSS flex changes)
  const resizeObserver = new ResizeObserver(() => {
    const r = container.getBoundingClientRect()
    // Update the view dimensions so the WebGL viewport and camera match the new container size
    deck.setProps({
      views: [new OrthographicView({ id: viewId, controller: true, width: r.width, height: r.height })]
    })
  })
  resizeObserver.observe(container)  // start observing size changes

  // Replaces all text labels with a new array of { position: [x, y], text: string } objects.
  // The image layer is preserved; only the TextLayer is rebuilt and swapped in.
  function setLabels(newLabels) {
    deck.setProps({ layers: [imageLayer, buildTextLayer(newLabels)] })
  }

  // Return the Deck instance and the label updater function.
  // Usage: const { deck, setLabels } = await initVivDeck(container, url)
  //        setLabels([{ position: [100, 200], text: 'My region' }])
  return { deck, setLabels }
}
