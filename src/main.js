import './style.css'
import { initVivDeck } from './viv-viewer.js'

const app = document.querySelector('#app')
// Render the viewer and a floating toolbar together.
// The toolbar sits in a fixed overlay so it doesn't affect the viewer's size.
app.innerHTML = `
  <div id="viewer" class="viewer"></div>
  <div class="toolbar">
    <button id="pan-btn"   class="tool-btn active">Pan / Zoom</button>
    <button id="draw-btn"  class="tool-btn">Draw</button>
    <button id="clear-btn" class="tool-btn">Clear Lines</button>
  </div>
`

// Change this if you want to target a different OME-Zarr endpoint.
const OME_ZARR_URL = 'http://localhost:8080/giga/'

initVivDeck(document.getElementById('viewer'), OME_ZARR_URL)
  .then(({ enableDrawing, disableDrawing, clearLines }) => {
    const drawBtn  = document.getElementById('draw-btn')
    const panBtn   = document.getElementById('pan-btn')
    const clearBtn = document.getElementById('clear-btn')

    // Switch to drawing mode: overlay captures pointer events, pan/zoom is paused
    drawBtn.onclick = () => {
      enableDrawing()
      drawBtn.classList.add('active')
      panBtn.classList.remove('active')
    }

    // Switch back to navigation mode: pointer events pass through to deck.gl again
    panBtn.onclick = () => {
      disableDrawing()
      panBtn.classList.add('active')
      drawBtn.classList.remove('active')
    }

    // Remove all drawn strokes without changing mode
    clearBtn.onclick = clearLines
  })
  .catch((err) => {
    console.error('Failed to initialize Viv viewer:', err)
    const el = document.createElement('div')
    el.className = 'error'
    el.textContent = `Failed to load OME-Zarr: ${err?.message || err}`
    app.appendChild(el)
  })
