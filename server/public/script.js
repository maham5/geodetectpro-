// Global variables
        let map, screenshoter, drawControl;
        let currentLayer = 'satellite';
        let detectionsDataTable = null; // DataTable instance
        let analytics = {
            totalDetections: 0,
            totalProcessTime: 0,
            successfulDetections: 0,
            objectsFound: 0
        };

        // Map layers
        const mapLayers = {
            satellite: L.tileLayer('http://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
                attribution: 'Google Satellite',
                maxZoom: 20
            }),
            street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            })
        };

        // Initialize map
        function initializeMap() {
            map = L.map('map', {
                center: [33.6844, 73.0479], // Islamabad coordinates
                zoom: 13,
                zoomControl: false
            });

            // Add default layer
            mapLayers[currentLayer].addTo(map);

            // Add zoom control to bottom right
            L.control.zoom({
                position: 'bottomright'
            }).addTo(map);

            // Add scale control
            L.control.scale({
                position: 'bottomleft'
            }).addTo(map);

            // Initialize screenshoter
            screenshoter = L.simpleMapScreenshoter().addTo(map);

            // Initialize drawing tools
            const drawnItems = new L.FeatureGroup();
            map.addLayer(drawnItems);

            drawControl = new L.Control.Draw({
                edit: {
                    featureGroup: drawnItems
                },
                draw: {
                    polygon: true,
                    polyline: true,
                    rectangle: true,
                    circle: true,
                    marker: true,
                    circlemarker: false
                }
            });

            // Map click handler for coordinates
            map.on('click', function(e) {
                const { lat, lng } = e.latlng;
                updateCoordinatesDisplay(lat, lng);
            });

            // Draw events
            map.on(L.Draw.Event.CREATED, function(e) {
                drawnItems.addLayer(e.layer);
                showStatusMessage('Shape drawn successfully', 'success');
            });

            console.log('Map initialized successfully');
        }

        // Update coordinates display
        function updateCoordinatesDisplay(lat, lng) {
            const coordsEl = document.getElementById('coordinatesDisplay');
            coordsEl.textContent = `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
        }

        // Layer switching
        function switchLayer(layerName) {
            if (mapLayers[currentLayer]) {
                map.removeLayer(mapLayers[currentLayer]);
            }
            
            currentLayer = layerName;
            mapLayers[currentLayer].addTo(map);
            
            // Update button states
            document.querySelectorAll('.layer-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            document.querySelector(`[data-layer="${layerName}"]`).classList.add('active');
            
            showStatusMessage(`Switched to ${layerName} view`, 'success');
        }

        // Search functionality
        async function geocodeLocation(query) {
            try {
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`
                );
                return await response.json();
            } catch (error) {
                console.error('Geocoding error:', error);
                return [];
            }
        }

        // Show search suggestions
        function showSearchSuggestions(suggestions) {
            const suggestionsEl = document.getElementById('searchSuggestions');
            
            if (!suggestions || suggestions.length === 0) {
                suggestionsEl.style.display = 'none';
                return;
            }

            suggestionsEl.innerHTML = suggestions.map(item => `
                <div class="suggestion-item" onclick="selectLocation(${item.lat}, ${item.lon}, '${item.display_name.replace(/'/g, "\\'")}')">
                    <div style="font-weight: 500;">${item.display_name.split(',')[0]}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">${item.display_name.split(',').slice(1, 3).join(', ')}</div>
                </div>
            `).join('');
            
            suggestionsEl.style.display = 'block';
        }

        // Select location from search
        function selectLocation(lat, lng, name) {
            map.setView([lat, lng], 16);
            updateCoordinatesDisplay(lat, lng);
            
            // Hide suggestions
            document.getElementById('searchSuggestions').style.display = 'none';
            document.getElementById('searchInput').value = name.split(',')[0];
            
            showStatusMessage(`Navigated to ${name.split(',')[0]}`, 'success');
        }

        // Object detection functionality
        async function captureAndDetect() {
            try {
                showProgress();
                updateProgress(10, 'Capturing screenshot...');

                const blob = await screenshoter.takeScreen('blob');
                updateProgress(30, 'Screenshot captured, sending for analysis...');

                const formData = new FormData();
                formData.append('screenshot', blob, 'screenshot.png');

                const startTime = Date.now();
                const response = await fetch('http://localhost:3000/api/process-screenshot', {
                    method: 'POST',
                    body: formData
                });

                updateProgress(70, 'Processing detection results...');

                if (!response.ok) {
                    throw new Error(`Server error: ${response.status}`);
                }

                const result = await response.json();
                const processTime = Date.now() - startTime;

                updateProgress(90, 'Finalizing results...');

                // Update analytics
                analytics.totalDetections++;
                analytics.totalProcessTime += processTime;
                analytics.successfulDetections++;
                analytics.objectsFound += result.detections ? result.detections.length : 0;
                
                updateProgress(100, 'Complete!');
                
                setTimeout(() => {
                    hideProgress();
                    showResults(blob, result);
                    // updateAnalytics(); // Commented out - analytics removed
                    showStatusMessage(`Detection completed in ${(processTime / 1000).toFixed(1)}s - Found ${result.detections ? result.detections.length : 0} objects`, 'success');
                }, 500);

            } catch (error) {
                console.error('Detection error:', error);
                hideProgress();
                showStatusMessage('Detection failed: ' + error.message, 'error');
            }
        }

        // Progress management
        function showProgress() {
            document.getElementById('progressContainer').classList.add('active');
            document.getElementById('captureBtn').disabled = true;
        }

        function updateProgress(percent, text) {
            document.getElementById('progressFill').style.width = percent + '%';
            document.getElementById('progressText').textContent = text;
        }

        function hideProgress() {
            document.getElementById('progressContainer').classList.remove('active');
            document.getElementById('captureBtn').disabled = false;
        }

        // Show results
        function showResults(originalBlob, result) {
            const originalUrl = URL.createObjectURL(originalBlob);
            
            // Handle processed image from base64 or URL
            let processedUrl;
            if (result.processedImageBase64) {
                // Create blob from base64
                const byteCharacters = atob(result.processedImageBase64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const processedBlob = new Blob([byteArray], { type: 'image/png' });
                processedUrl = URL.createObjectURL(processedBlob);
                window.currentProcessedBlob = processedBlob;
            } else if (result.url) {
                // Fallback to URL (for backward compatibility)
                processedUrl = result.url;
            }

            document.getElementById('originalImage').src = originalUrl;
            document.getElementById('processedImage').src = processedUrl;
            document.getElementById('resultsContainer').classList.add('active');

            // Show detections table if we have detections data
            if (result.detections && result.detections.length > 0) {
                showDetectionsTable(result.detections);
            } else {
                hideDetectionsTable();
            }
        }

        // Show detections table
        function showDetectionsTable(detections) {
            const detectionsSection = document.getElementById('detectionsSection');
            const detectionsCount = document.getElementById('detectionsCount');
            
            // Update count
            detectionsCount.textContent = `${detections.length} object${detections.length !== 1 ? 's' : ''} detected`;
            
            // Initialize DataTable if not already done
            if (!detectionsDataTable) {
                initializeDetectionsTable();
            }
            
            // Clear existing data
            detectionsDataTable.clear();
            
            // Add new data
            detections.forEach(detection => {
                // Format coordinates as a readable string
                const coords = detection.points ? 
                    `(${detection.points[0][0].toFixed(1)}, ${detection.points[0][1].toFixed(1)}) to (${detection.points[2][0].toFixed(1)}, ${detection.points[2][1].toFixed(1)})` :
                    'N/A';
                
                // Format confidence as percentage for display but keep numeric value for sorting
                const confidenceValue = detection.score ? detection.score : 0;
                const confidenceDisplay = detection.score ? `${(detection.score * 100).toFixed(1)}%` : 'N/A';
                const confidenceClass = getConfidenceClass(detection.score);
                
                // Add row to DataTable
                detectionsDataTable.row.add([
                    detection.id || 'N/A',
                    `<span class="category-badge">${detection.category || 'Unknown'}</span>`,
                    `<span class="confidence-score confidence-${confidenceClass}" data-sort="${confidenceValue}">${confidenceDisplay}</span>`,
                    `<span class="coordinates" title="${coords}">${coords}</span>`
                ]);
            });
            
            // Draw the table
            detectionsDataTable.draw();
            
            // Show the section
            detectionsSection.style.display = 'block';
        }

        // Hide detections table
        function hideDetectionsTable() {
            document.getElementById('detectionsSection').style.display = 'none';
            if (detectionsDataTable) {
                detectionsDataTable.clear().draw();
            }
        }

        // Get confidence class for styling
        function getConfidenceClass(score) {
            if (!score) return 'low';
            if (score >= 0.8) return 'high';
            if (score >= 0.6) return 'medium';
            return 'low';
        }

        // Initialize DataTable
        function initializeDetectionsTable() {
            if (detectionsDataTable) {
                detectionsDataTable.destroy();
            }
            
            detectionsDataTable = $('#detectionsTable').DataTable({
                responsive: true,
                pageLength: 10,
                lengthMenu: [[10, 25, 50, -1], [10, 25, 50, "All"]],
                order: [[2, 'desc']], // Sort by confidence score descending
                columnDefs: [
                    {
                        targets: 0, // ID column
                        width: '15%',
                        className: 'text-center'
                    },
                    {
                        targets: 1, // Category column
                        width: '25%',
                        className: 'text-center'
                    },
                    {
                        targets: 2, // Confidence column
                        width: '20%',
                        className: 'text-center',
                        type: 'num-fmt' // For proper sorting of percentages
                    },
                    {
                        targets: 3, // Coordinates column
                        width: '40%',
                        orderable: false
                    }
                ],
                dom: '<"row"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>' +
                     '<"row"<"col-sm-12"tr>>' +
                     '<"row"<"col-sm-12 col-md-5"i><"col-sm-12 col-md-7"p>>',
                language: {
                    search: "Search detections:",
                    lengthMenu: "Show _MENU_ detections",
                    info: "Showing _START_ to _END_ of _TOTAL_ detections",
                    infoEmpty: "No detections found",
                    infoFiltered: "(filtered from _MAX_ total detections)",
                    emptyTable: "No detection data available",
                    zeroRecords: "No matching detections found"
                },
                searching: true,
                paging: true,
                info: true,
                autoWidth: false,
                processing: true
            });
        }

        // Status messages
        function showStatusMessage(message, type = 'success') {
            const statusEl = document.getElementById('statusMessage');
            statusEl.innerHTML = `<div class="status-message status-${type}">${message}</div>`;
            
            setTimeout(() => {
                statusEl.innerHTML = '';
            }, 5000);
        }

        // Update analytics display - COMMENTED OUT
        /*
        function updateAnalytics() {
            document.getElementById('totalDetections').textContent = analytics.totalDetections;
            document.getElementById('avgProcessTime').textContent = 
                analytics.totalDetections > 0 ? 
                `${(analytics.totalProcessTime / analytics.totalDetections / 1000).toFixed(1)}s` : '-';
            document.getElementById('successRate').textContent = 
                analytics.totalDetections > 0 ? 
                `${Math.round((analytics.successfulDetections / analytics.totalDetections) * 100)}%` : '100%';
        }
        */

        // Load downloads list - COMMENTED OUT  
        /*
        async function loadDownloadsList() {
            try {
                const response = await fetch('http://localhost:3000/api/downloads-images');
                const images = await response.json();
                
                const downloadsEl = document.getElementById('downloadsList');
                const countEl = document.getElementById('downloadCount');
                
                countEl.textContent = images.length;

                if (images.length === 0) {
                    downloadsEl.innerHTML = `
                        <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                            <i class="fas fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.5;"></i>
                            <div>No downloads yet</div>
                        </div>
                    `;
                    return;
                }

                downloadsEl.innerHTML = images.slice(0, 10).map(img => `
                    <div class="download-item">
                        <div class="download-info">
                            <div class="download-name">${img.name}</div>
                            <div class="download-date">${new Date(img.modified).toLocaleString()}</div>
                        </div>
                        <button class="btn btn-icon btn-secondary" onclick="downloadFile('${img.name}')">
                            <i class="fas fa-download"></i>
                        </button>
                    </div>
                `).join('');

            } catch (error) {
                console.error('Error loading downloads:', error);
                showStatusMessage('Failed to load downloads', 'error');
            }
        }
        */

        // Download file
        function downloadFile(filename) {
            // Implementation would depend on server endpoint
            showStatusMessage(`Downloading ${filename}`, 'success');
        }

        // Toggle fullscreen for results
        function toggleFullscreen() {
            const resultsContainer = document.getElementById('resultsContainer');
            
            if (document.querySelector('.results-fullscreen')) {
                // Exit fullscreen
                document.querySelector('.results-fullscreen').remove();
                return;
            }

            // Enter fullscreen
            const fullscreenDiv = document.createElement('div');
            fullscreenDiv.className = 'results-fullscreen';
            
            const resultGrid = document.getElementById('resultGrid').cloneNode(true);
            resultGrid.querySelectorAll('.results-fullscreen-toggle').forEach(btn => btn.remove());
            
            fullscreenDiv.innerHTML = `
                <button class="fullscreen-close" onclick="toggleFullscreen()">
                    <i class="fas fa-times"></i>
                </button>
            `;
            fullscreenDiv.appendChild(resultGrid);
            
            document.body.appendChild(fullscreenDiv);
            
            // Close on escape key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    toggleFullscreen();
                    document.removeEventListener('keydown', escapeHandler);
                }
            };
            document.addEventListener('keydown', escapeHandler);
        }

        // Check server connection
        async function checkServerConnection() {
            try {
                const response = await fetch('http://localhost:3000/api/health');
                const health = await response.json();
                
                document.getElementById('connectionStatus').textContent = 'Connected';
                document.querySelector('.status-indicator').style.background = 'var(--success-color)';
                
                return true;
            } catch (error) {
                document.getElementById('connectionStatus').textContent = 'Disconnected';
                document.querySelector('.status-indicator').style.background = 'var(--error-color)';
                
                showStatusMessage('Server connection failed', 'error');
                return false;
            }
        }

        // Event listeners
        document.addEventListener('DOMContentLoaded', function() {
            // Initialize map
            initializeMap();

            // Layer controls
            document.querySelectorAll('.layer-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    switchLayer(btn.dataset.layer);
                });
            });

            // Tool controls - COMMENTED OUT (buttons removed)
            /*
            document.getElementById('measureBtn').addEventListener('click', () => {
                // Toggle measurement tool
                showStatusMessage('Measurement tool activated - click on map to measure', 'success');
            });

            document.getElementById('drawBtn').addEventListener('click', () => {
                // Toggle drawing tools
                if (map.hasControl(drawControl)) {
                    map.removeControl(drawControl);
                    showStatusMessage('Drawing tools disabled', 'success');
                } else {
                    map.addControl(drawControl);
                    showStatusMessage('Drawing tools enabled', 'success');
                }
            });

            document.getElementById('fullscreenBtn').addEventListener('click', () => {
                if (map.getContainer().requestFullscreen) {
                    map.getContainer().requestFullscreen();
                }
            });
            */

            // Search functionality
            let searchTimeout;
            document.getElementById('searchInput').addEventListener('input', function(e) {
                clearTimeout(searchTimeout);
                const query = e.target.value.trim();
                
                if (query.length < 2) {
                    document.getElementById('searchSuggestions').style.display = 'none';
                    return;
                }

                searchTimeout = setTimeout(async () => {
                    const suggestions = await geocodeLocation(query);
                    showSearchSuggestions(suggestions);
                }, 300);
            });

            document.getElementById('searchBtn').addEventListener('click', async () => {
                const query = document.getElementById('searchInput').value.trim();
                if (query) {
                    const results = await geocodeLocation(query);
                    if (results.length > 0) {
                        selectLocation(results[0].lat, results[0].lon, results[0].display_name);
                    }
                }
            });

            // Detection controls
            document.getElementById('captureBtn').addEventListener('click', captureAndDetect);

            // Download functionality
            document.getElementById('downloadBtn').addEventListener('click', () => {
                if (window.currentProcessedBlob) {
                    const url = URL.createObjectURL(window.currentProcessedBlob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `detection-result-${Date.now()}.png`;
                    link.click();
                    URL.revokeObjectURL(url);
                    showStatusMessage('Download started', 'success');
                }
            });

            // Refresh downloads - COMMENTED OUT
            // document.getElementById('refreshDownloadsBtn').addEventListener('click', loadDownloadsList);

            // Initial loads
            checkServerConnection();
            // loadDownloadsList(); // Commented out - downloads panel removed
            // updateAnalytics(); // Commented out - analytics panel removed

            // Periodic health check
            setInterval(checkServerConnection, 30000);
        });

        // Hide search suggestions when clicking outside
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.search-container')) {
                document.getElementById('searchSuggestions').style.display = 'none';
            }
        });

          const ctx = document.getElementById("myChart").getContext("2d");

 // Dummy detections (sirf Airplane ke)
const detections = [
  { id: 1, category: "Airplane", confidence: "95%", coordinates: "[100,200]" },
  { id: 2, category: "Airplane", confidence: "60%", coordinates: "[200,300]" },
  { id: 3, category: "Airplane", confidence: "40%", coordinates: "[150,250]" }
];

// X-axis labels (IDs)
const labels = detections.map(d => `ID:${d.id}`);

// Confidence values ko number banaya (95, 90, 87)
const data = detections.map(d => parseInt(d.confidence));

new Chart(ctx, {
  type: "bar",
  data: {
    labels: labels,
    datasets: [{
      label: "Airplane Detection Confidence",
      data: data,
      backgroundColor: "#dbbc34ff",
     
      barPercentage: 0.5,
      categoryPercentage: 0.6
    }]
  },
  options: {
    devicePixelRatio: 3,
    responsive: true,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: "Airplane Detection Details",
        color: "#fff"
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const d = detections[context.dataIndex];
            return [
              `Category: ${d.category}`,
              `Confidence: ${d.confidence}`,
              `Coordinates: ${d.coordinates}`
            ];
          }
        },
          bodyFont: {
          size: 14,
        
        },
      }
    },
    scales: {
      x: {
        ticks: { color: "#fff" },   // X-axis labels white
        title: {
          display: true,
          text: "Detection IDs",
          color: "#fff",
            font: { size: 16 }
        },
            font: { size: 14}
      },
      y: {
        beginAtZero: true,
        ticks: { color: "#fff" },
         font: { size: 14 }
      }
    }
  }
});

    document.getElementById("captureBtn").addEventListener("click", () => {
  const loadingDiv = document.getElementById("loadingDiv");

  // Show loading
  loadingDiv.style.display = "block";

  // Simulate analysis delay (3s)
  setTimeout(() => {
    loadingDiv.style.display = "none";
    alert("Analysis Complete ✅"); // baad me tum yahan apna real result show karwa sakti ho
  }, 3000);
});


document.getElementById("captureBtn").addEventListener("click", function () {
  const sidebar = document.getElementById("resultsContainer");
  sidebar.classList.add("active"); // show sidebar
});
