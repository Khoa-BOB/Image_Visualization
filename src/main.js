import './style.css'
import { initVivDeck } from './viv-viewer.js'

const app = document.querySelector('#app')
app.innerHTML = `<div id="viewer" class="viewer"></div>`

// Change this if you want to target a different OME-Zarr endpoint.
const OME_ZARR_URL = 'http://localhost:8080/zarr/'

initVivDeck(document.getElementById('viewer'), OME_ZARR_URL)
  .catch((err) => {
    console.error('Failed to initialize Viv viewer:', err)
    const el = document.createElement('div')
    el.className = 'error'
    el.textContent = `Failed to load OME-Zarr: ${err?.message || err}`
    app.appendChild(el)
  })
