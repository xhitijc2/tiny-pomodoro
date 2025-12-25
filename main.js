const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const screenshot = require('screenshot-desktop');

// Parse command line arguments for timer duration
const args = process.argv.slice(2);
console.log('Process arguments:', process.argv);
console.log('Extracted args:', args);

// Check for test mode (either -1 or 'test' keyword)
let validTimerMinutes;
if (args.length > 0 && (args[0] === '-1' || args[0] === 'test')) {
  validTimerMinutes = 0.05; // 3 seconds = 0.05 minutes for testing
  console.log('Test mode activated: 3 second timer');
} else {
  const timerMinutes = args.length > 0 ? parseInt(args[0], 10) : 10; // Default to 10 minutes
  validTimerMinutes = isNaN(timerMinutes) || timerMinutes <= 0 ? 10 : timerMinutes;
  console.log('Timer set to:', validTimerMinutes, 'minutes');
}

// CSV logging functionality
function getLogFilePath() {
  // Store CSV file in the project directory for easy access
  return path.join(__dirname, 'pomodoro-daily-log.csv');
}

function ensureCSVHeaders() {
  const logFilePath = getLogFilePath();
  if (!fs.existsSync(logFilePath)) {
    const headers = 'Timestamp,Date,Day,Month,Year,Time,Type,Duration (min),Pomodoros Completed,Work Description\n';
    fs.writeFileSync(logFilePath, headers, 'utf8');
  }
}

function logDailyCounter(dateStr, day, month, year, counter) {
  try {
    const logFilePath = getLogFilePath();
    ensureCSVHeaders();
    
    const now = new Date();
    const timestamp = now.toISOString();
    const timeStr = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
    
    // Type is "daily_summary" for end-of-day logs
    const logEntry = `${timestamp},"${dateStr}",${day},${month},${year},"${timeStr}","daily_summary",,${counter},\n`;
    fs.appendFileSync(logFilePath, logEntry, 'utf8');
    
    console.log(`Daily counter logged: ${dateStr} - ${counter} pomodoros`);
    return true;
  } catch (error) {
    console.error('Error logging daily counter:', error);
    return false;
  }
}

// IPC handler for logging daily counter
ipcMain.handle('log-daily-counter', (event, data) => {
  const { dateStr, day, month, year, counter } = data;
  return logDailyCounter(dateStr, day, month, year, counter);
});

// IPC handler to get log file path for user reference
ipcMain.handle('get-log-file-path', () => {
  return getLogFilePath();
});

// Function to log work description to the same CSV file
function logWorkDescription(timestamp, description, duration) {
  try {
    const logFilePath = getLogFilePath();
    ensureCSVHeaders();
    
    const date = new Date(timestamp);
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const dateStr = `${day}/${month}/${year}`;
    const timeStr = date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
    
    // Escape description for CSV (handle commas and quotes)
    const escapedDescription = description.replace(/"/g, '""');
    
    // Type is "work_session" for work description logs
    // Format: Timestamp,Date,Day,Month,Year,Time,Type,Duration (min),Pomodoros Completed,Work Description
    const logEntry = `${timestamp},"${dateStr}",${day},${month},${year},"${timeStr}","work_session",${duration},,"${escapedDescription}"\n`;
    
    fs.appendFileSync(logFilePath, logEntry, 'utf8');
    
    console.log(`Work description logged: ${description} (${duration} min)`);
    return true;
  } catch (error) {
    console.error('Error logging work description:', error);
    return false;
  }
}

// IPC handler for logging work descriptions
ipcMain.handle('log-work-description', (event, data) => {
  const { timestamp, description, duration } = data;
  return logWorkDescription(timestamp, description, duration);
});

// Screenshot functionality
let screenshotInterval = null;
let currentSessionFolder = null;
let screenshotCount = 0;

function getScreenshotsBaseDir() {
  return path.join(__dirname, 'screenshots');
}

function createSessionFolder() {
  const baseDir = getScreenshotsBaseDir();
  
  // Ensure base screenshots directory exists
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  
  // Create session-specific folder with timestamp
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const sessionFolder = path.join(baseDir, `session_${timestamp}`);
  
  fs.mkdirSync(sessionFolder, { recursive: true });
  console.log(`Created session folder: ${sessionFolder}`);
  
  return sessionFolder;
}

async function captureScreenshot(sessionFolder) {
  try {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `screenshot_${timestamp}.png`;
    const filepath = path.join(sessionFolder, filename);
    
    // Capture screenshot
    const imgBuffer = await screenshot({ format: 'png' });
    fs.writeFileSync(filepath, imgBuffer);
    
    screenshotCount++;
    console.log(`Screenshot saved: ${filename}`);
    return true;
  } catch (error) {
    console.error('Error capturing screenshot:', error);
    return false;
  }
}

function startScreenshotCapture() {
  // Check if screenshots are disabled
  if (!ENABLE_SCREENSHOTS) {
    console.log('📸 Screenshot capture is disabled (ENABLE_SCREENSHOTS = false)');
    return;
  }
  
  if (screenshotInterval) {
    console.log('Screenshot capture already running');
    return;
  }
  
  // Reset screenshot counter for new session
  screenshotCount = 0;
  
  // Create a new session folder
  currentSessionFolder = createSessionFolder();
  
  // Take initial screenshot immediately
  captureScreenshot(currentSessionFolder);
  
  // Take screenshot every 5 seconds
  screenshotInterval = setInterval(() => {
    captureScreenshot(currentSessionFolder);
  }, 5000);
  
  console.log('📸 Screenshot capture started - every 5 seconds');
  console.log(`📁 Screenshots folder: ${currentSessionFolder}`);
}

function stopScreenshotCapture() {
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
    if (currentSessionFolder) {
      console.log('📸 Screenshot capture stopped');
      console.log(`📁 Screenshots saved to: ${currentSessionFolder}`);
      console.log(`📊 Total screenshots taken: ${screenshotCount}`);
    }
  }
  currentSessionFolder = null;
}

// IPC handlers for screenshot control
ipcMain.handle('start-screenshots', () => {
  startScreenshotCapture();
  return true;
});

ipcMain.handle('stop-screenshots', () => {
  stopScreenshotCapture();
  return true;
});

// 🎛️ USER CONFIGURABLE SETTINGS
// Change these values to adjust the app size to your preference
const APP_WIDTH = 110;   // Window width in pixels (recommended: 100-200)
const APP_HEIGHT = 75;   // Window height in pixels (recommended: 60-100)
const ENABLE_SCREENSHOTS = false; // Set to false to disable screenshot capture while working

function createWindow () {
  const win = new BrowserWindow({
    width: APP_WIDTH,
    height: APP_HEIGHT,
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    transparent: true,  // Keep transparency for the glass effect
    vibrancy: 'fullscreen-ui', // Enable macOS vibrancy for backdrop blur
    visualEffectState: 'active', // Keep blur effect always active
    hasShadow: false,
    skipTaskbar: true, // Hide from taskbar for utility apps
    minimizable: false, // Prevent minimizing
    closable: false, // Prevent accidental closing
    type: 'panel', // macOS utility panel type
    webPreferences: {
      preload: path.join(__dirname, 'renderer.js'),
      nodeIntegration: true,
      contextIsolation: false,
      additionalArguments: [`--timer-minutes=${validTimerMinutes}`],
      enableRemoteModule: true
    }
  });

  // 🧷 Important: Keep above other windows permanently
  win.setAlwaysOnTop(true, 'floating'); // Floating level for utility apps
  win.setVisibleOnAllWorkspaces(true); // ensures it's visible across spaces
  win.setFullScreenable(false);
  
  // Position the window in the top-right corner
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  win.setPosition(width - APP_WIDTH - 10, 10); // 10px from top-right corner
  
  // Force the window to stay always on top WITHOUT stealing focus
  const forceAlwaysOnTop = () => {
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(true, 'floating');
      win.showInactive(); // Show without stealing focus
    }
  };
  
  // Handle window events without stealing focus
  win.on('show', forceAlwaysOnTop);
  win.on('restore', forceAlwaysOnTop);
  
  // macOS-specific: Handle window state changes
  win.on('hide', () => {
    if (win && !win.isDestroyed()) {
      win.showInactive();
    }
  });
  
  // Ensure window stays visible and positioned correctly
  const maintainWindow = () => {
    if (win && !win.isDestroyed()) {
      if (!win.isVisible()) {
        win.showInactive();
      }
      forceAlwaysOnTop();
    }
  };
  
  // Check every 2 seconds instead of 3 for better responsiveness
  setInterval(maintainWindow, 2000);

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      // If window exists, ensure it's always on top without stealing focus
      const win = BrowserWindow.getAllWindows()[0];
      win.showInactive();
      win.setAlwaysOnTop(true, 'floating');
    }
  });
  
  // Removed aggressive focus handlers to prevent focus stealing
  
  // Additional macOS specific events
  app.on('will-quit', (event) => {
    event.preventDefault(); // Prevent quitting
  });
  
  app.on('before-quit', (event) => {
    event.preventDefault(); // Prevent quitting
  });
});

app.on('window-all-closed', () => {
  // Prevent closing on macOS - keep the app running
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
