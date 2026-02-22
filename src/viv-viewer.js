import { Deck, OrthographicView } from '@deck.gl/core'
import { MultiscaleImageLayer } from '@vivjs/layers'
import { loadOmeZarr, isInterleaved, getChannelStats } from '@vivjs/loaders'
import { DTYPE_VALUES } from '@vivjs/constants'

function getSelectionsForChannels(baseSource, channelIndices = [0]) {
  const labels = baseSource.labels || []
  const hasC = labels.includes('c')
  const hasZ = labels.includes('z')
  const hasT = labels.includes('t')

  return channelIndices.map((c) => {
    const sel = {}
    if (hasT) sel.t = 0
    if (hasZ) sel.z = 0
    if (hasC) sel.c = c
    return sel
  })
}

function getDefaultContrast(max, n) {
  // Use full range per channel by default
  return Array.from({ length: n }, () => [0, max])
}

function getChannelsVisible(n) {
  // Show up to first 3 channels by default; others off
  return Array.from({ length: n }, (_, i) => i < 3)
}

function getDefaultColors(n) {
  const palette = [
    [255, 0, 0],    // R
    [0, 255, 0],    // G
    [0, 0, 255],    // B
    [0, 255, 255],  // C
    [255, 0, 255],  // M
    [255, 255, 0]   // Y
  ]
  return Array.from({ length: n }, (_, i) => palette[i % palette.length])
}

function computeInitialViewState(pyramid, viewWidth, viewHeight, backoff = 0.25) {
  const base = Array.isArray(pyramid) ? pyramid[0] : pyramid
  // Center on image and fit to view
  const width = base.shape[base.labels.indexOf('x')]
  const height = base.shape[base.labels.indexOf('y')]
  const zoom = Math.log2(Math.min(viewWidth / width, viewHeight / height)) - backoff
  return {
    target: [width / 2, height / 2, 0],
    zoom
  }
}

export async function initVivDeck(container, omeZarrUrl) {
  if (!container) throw new Error('Missing container element')

  // Load OME-Zarr multiscale image
  const { data: pyramid /* PixelSource[] */ } = await loadOmeZarr(omeZarrUrl, {
    type: 'multiscales'
  })

  const base = pyramid[0]
  const labels = base.labels || []
  const cIndex = labels.indexOf('c')
  const interleaved = isInterleaved(base.shape)
  const totalChannels = interleaved ? (base.shape[base.shape.length - 1] === 4 ? 4 : 3) : (cIndex >= 0 ? base.shape[cIndex] : 1)
  const maxChannels = Math.min(totalChannels, 6)
  const selections = interleaved
    ? [{}] // RGB(A) bitmap path ignores channel selections
    : getSelectionsForChannels(base, Array.from({ length: maxChannels }, (_, i) => i))

  // Determine dtype max and compute reasonable contrast limits
  const dtype = base.dtype || 'Uint16'
  const dtypeInfo = DTYPE_VALUES[dtype] || DTYPE_VALUES.Uint16
  let contrastLimits = interleaved
    ? []
    : getDefaultContrast(dtypeInfo.max, maxChannels)

  // Try to infer contrast limits from downsampled raster stats (best-effort)
  if (!interleaved) {
    try {
      const lowRes = pyramid[pyramid.length - 1]
      const statsPromises = selections.map(async (sel) => {
        const { data } = await lowRes.getRaster({ selection: sel })
        const { contrastLimits } = getChannelStats(Array.from(data))
        return contrastLimits
      })
      const stats = await Promise.all(statsPromises)
      contrastLimits = stats
    } catch (_) {
      // keep default contrast limits on failure
    }
  }

  // Set initial view state to fit
  const rect = container.getBoundingClientRect()
  const initialVS = computeInitialViewState(pyramid, Math.max(1, rect.width), Math.max(1, rect.height), 0.25)

  // Ensure the view has an id, since Viv layers use viewportId to sync
  const viewId = 'detail'
  const deck = new Deck({
    parent: container,
    views: [new OrthographicView({ id: viewId, controller: true })],
    initialViewState: { id: viewId, ...initialVS },
    layers: [
      new MultiscaleImageLayer({
        id: 'ome-zarr-layer',
        loader: pyramid,
        selections: selections.length ? selections : [{}],
        contrastLimits,
        channelsVisible: interleaved ? [] : Array(maxChannels).fill(true),
        colors: interleaved ? undefined : getDefaultColors(maxChannels),
        viewportId: viewId
      })
    ]
  })

  // Handle container resize
  const resizeObserver = new ResizeObserver(() => {
    const r = container.getBoundingClientRect()
    deck.setProps({
      views: [new OrthographicView({ id: viewId, controller: true, width: r.width, height: r.height })]
    })
  })
  resizeObserver.observe(container)

  return deck
}
