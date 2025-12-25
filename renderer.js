// 🎛️ Parse timer duration from command line arguments
// Extract timer minutes from process arguments passed by main process
function getTimerMinutes() {
  const args = process.argv;
  const timerArg = args.find(arg => arg.startsWith('--timer-minutes='));
  if (timerArg) {
    const minutes = parseFloat(timerArg.split('=')[1]);
    // Handle the special case where 0.05 minutes = 3 seconds (for testing)
    if (minutes === 0.05) {
      return 0.05;
    }
    return isNaN(minutes) || minutes <= 0 ? 10 : minutes;
  }
  return 10; // Default: 10 minutes
}

const timer_mins = getTimerMinutes();

let time = timer_mins * 60; // Convert minutes to seconds
let interval = null;
let isRunning = false;
let isBlinking = false;
let blinkInterval = null;
let blinkIndex = 0;

const timerEl = document.getElementById('timer');
const toggleBtn = document.getElementById('toggleBtn');
const resetBtn = document.getElementById('resetBtn');
const acknowledgeBtn = document.getElementById('acknowledgeBtn');

// Work modal elements
const workModal = document.getElementById('workModal');
const workInput = document.getElementById('workInput');
const workSkipBtn = document.getElementById('workSkipBtn');
const workSubmitBtn = document.getElementById('workSubmitBtn');

// Counter elements
const todayDate = document.getElementById('today-date');
const counterValue = document.getElementById('counter-value');
const counterDecrease = document.getElementById('counter-decrease');
const counterIncrease = document.getElementById('counter-increase');

// Counter state
let dailyCounter = 0;
let lastLoggedDate = null;

// Counter functions
function getTodayKey() {
  const today = new Date();
  return `pomodoro-counter-${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
}

function displayTodayDate() {
  // Get current date in IST
  const now = new Date();
  const istDate = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
  const day = istDate.getDate();
  const month = istDate.getMonth() + 1; // getMonth() returns 0-11, so add 1
  todayDate.textContent = `${day}.${month}`;
}

function loadDailyCounter() {
  const todayKey = getTodayKey();
  const saved = localStorage.getItem(todayKey);
  dailyCounter = saved ? parseInt(saved, 10) : 0;
  updateCounterDisplay();
}

function saveDailyCounter() {
  const todayKey = getTodayKey();
  localStorage.setItem(todayKey, dailyCounter.toString());
}

function updateCounterDisplay() {
  counterValue.textContent = dailyCounter.toString();
}

// Daily logging functions
function getDateString(date) {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function getLastLoggedDateKey() {
  return 'pomodoro-last-logged-date';
}

function loadLastLoggedDate() {
  const saved = localStorage.getItem(getLastLoggedDateKey());
  return saved ? saved : null;
}

function saveLastLoggedDate(dateStr) {
  localStorage.setItem(getLastLoggedDateKey(), dateStr);
}

async function logDailyCounterToCSV(date, counter) {
  try {
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const dateStr = getDateString(date);
    
    const { ipcRenderer } = require('electron');
    const success = await ipcRenderer.invoke('log-daily-counter', {
      dateStr,
      day,
      month,
      year,
      counter
    });
    
    if (success) {
      console.log(`Successfully logged ${counter} pomodoros for ${dateStr}`);
      saveLastLoggedDate(dateStr);
    } else {
      console.error(`Failed to log data for ${dateStr}`);
    }
    
    return success;
  } catch (error) {
    console.error('Error in logDailyCounterToCSV:', error);
    return false;
  }
}

function checkAndLogPreviousDay() {
  const now = new Date();
  const today = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
  const todayStr = getDateString(today);
  
  const lastLogged = loadLastLoggedDate();
  
  if (lastLogged && lastLogged !== todayStr) {
    // Day has changed, we need to log the previous day's data
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = `pomodoro-counter-${yesterday.getFullYear()}-${yesterday.getMonth() + 1}-${yesterday.getDate()}`;
    const yesterdayCounter = localStorage.getItem(yesterdayKey);
    
    if (yesterdayCounter) {
      const counter = parseInt(yesterdayCounter, 10);
      logDailyCounterToCSV(yesterday, counter);
    }
  } else if (!lastLogged) {
    // First time running, set today as the last logged date
    saveLastLoggedDate(todayStr);
  }
}

function incrementCounter() {
  dailyCounter++;
  updateCounterDisplay();
  saveDailyCounter();
}

function decrementCounter() {
  if (dailyCounter > 0) {
    dailyCounter--;
    updateCounterDisplay();
    saveDailyCounter();
  }
}

function updateTimerDisplay() {
  const minutes = Math.floor(time / 60);
  const seconds = time % 60;
  timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function startBlinking() {
  if (blinkInterval) return;
  
  isBlinking = true;
  blinkIndex = 0;
  document.body.classList.add('blinking');
  
  // Blinking sequence: blank, red, green, blue (2 colors per second = 0.25s each)
  const blinkColors = ['blink-blank', 'blink-red', 'blink-green', 'blink-blue'];
  
  blinkInterval = setInterval(() => {
    // Remove previous color class
    document.body.classList.remove(...blinkColors);
    
    // Add current color class
    document.body.classList.add(blinkColors[blinkIndex]);
    
    // Move to next color
    blinkIndex = (blinkIndex + 1) % blinkColors.length;
  }, 250); // 250ms = 0.25 seconds for 2 colors per second
}

async function stopBlinking() {
  if (!isBlinking) return;

  clearInterval(blinkInterval);
  blinkInterval = null;
  isBlinking = false;
  blinkIndex = 0;

  // Remove all blinking classes
  document.body.classList.remove('blinking', 'blink-blank', 'blink-red', 'blink-green', 'blink-blue');

  // Increment counter since timer was completed
  incrementCounter();

  // Reset timer to original value (without showing modal)
  await stopTimer();
  time = timer_mins * 60;
  updateTimerDisplay();
  
  // Show work modal after timer completion
  showWorkModal();
}

async function startTimer() {
  if (interval) return;
  isRunning = true;
  toggleBtn.textContent = '⏸';
  
  // Start screenshot capture when timer starts
  try {
    const { ipcRenderer } = require('electron');
    await ipcRenderer.invoke('start-screenshots');
    console.log('Screenshots started');
  } catch (error) {
    console.error('Error starting screenshots:', error);
  }
  
  interval = setInterval(() => {
    if (time > 0) {
      time--;
      updateTimerDisplay();
    } else {
      clearInterval(interval);
      interval = null;
      isRunning = false;
      toggleBtn.textContent = '▶';
      new Notification('Pomodoro Finished!', { body: 'Take a break ☕' });
      startBlinking();
    }
  }, 1000);
}

async function stopTimer() {
  clearInterval(interval);
  interval = null;
  isRunning = false;
  toggleBtn.textContent = '▶';
  
  // Stop screenshot capture when timer stops
  try {
    const { ipcRenderer } = require('electron');
    await ipcRenderer.invoke('stop-screenshots');
    console.log('Screenshots stopped');
  } catch (error) {
    console.error('Error stopping screenshots:', error);
  }
  
  console.log('Timer stopped');
}

function showWorkModal() {
  workModal.style.display = 'flex';
  workInput.value = '';
  workInput.focus();
}

function hideWorkModal() {
  workModal.style.display = 'none';
  workInput.value = '';
}

async function saveWorkDescription(description) {
  if (description && description.trim()) {
    const timestamp = new Date().toISOString();
    const workLog = {
      timestamp,
      description: description.trim(),
      duration: timer_mins
    };
    
    // Save to localStorage
    const workHistoryKey = 'pomodoro-work-history';
    let workHistory = [];
    try {
      const saved = localStorage.getItem(workHistoryKey);
      if (saved) {
        workHistory = JSON.parse(saved);
      }
    } catch (e) {
      console.error('Error loading work history:', e);
    }
    
    workHistory.push(workLog);
    localStorage.setItem(workHistoryKey, JSON.stringify(workHistory));
    
    console.log('Work saved:', workLog);
    
    // Also log to CSV file
    try {
      const { ipcRenderer } = require('electron');
      const success = await ipcRenderer.invoke('log-work-description', {
        timestamp,
        description: description.trim(),
        duration: timer_mins
      });
      
      if (success) {
        console.log('Work description logged to CSV');
      }
    } catch (error) {
      console.error('Error logging work to CSV:', error);
    }
  }
}

async function toggleTimer() {
  if (isRunning) {
    await stopTimer();
  } else {
    await startTimer();
  }
}

async function resetTimer() {
  // If timer was running and has some time elapsed, show work modal
  const wasRunning = isRunning;
  const timeElapsed = (timer_mins * 60) - time;
  
  await stopTimer();
  time = timer_mins * 60;
  updateTimerDisplay();
  
  // Show work modal if timer was abruptly stopped (had elapsed time)
  if (wasRunning && timeElapsed > 0) {
    showWorkModal();
  }
}

toggleBtn.addEventListener('click', toggleTimer);
resetBtn.addEventListener('click', resetTimer);

// Counter event listeners
counterIncrease.addEventListener('click', incrementCounter);
counterDecrease.addEventListener('click', decrementCounter);

// Acknowledge button listener - only stops blinking when this specific button is clicked
acknowledgeBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  if (isBlinking) {
    stopBlinking();
  }
});

// Work modal event listeners
workSkipBtn.addEventListener('click', () => {
  hideWorkModal();
});

workSubmitBtn.addEventListener('click', async () => {
  const description = workInput.value;
  await saveWorkDescription(description);
  hideWorkModal();
});

// Handle Enter key in work input
workInput.addEventListener('keydown', async (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    const description = workInput.value;
    await saveWorkDescription(description);
    hideWorkModal();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    hideWorkModal();
  }
});

// Initialize logging system and periodic checks
async function initializeLogging() {
  // Check for day changes when app starts
  checkAndLogPreviousDay();
  
  // Check for day changes every hour
  setInterval(checkAndLogPreviousDay, 60 * 60 * 1000);
  
  // Log current day's data when window is about to close or reload
  window.addEventListener('beforeunload', async (event) => {
    const now = new Date();
    const today = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    if (dailyCounter > 0) {
      await logDailyCounterToCSV(today, dailyCounter);
    }
  });
  
  // Show user where log file is stored
  try {
    const { ipcRenderer } = require('electron');
    const logFilePath = await ipcRenderer.invoke('get-log-file-path');
    console.log(`📊 Daily pomodoro data is being logged to: ${logFilePath}`);
    console.log(`💡 Use Cmd+L (or Ctrl+L) to manually save current day's data`);
  } catch (error) {
    console.error('Could not get log file path:', error);
  }
}

// Manual logging function for testing or end-of-day logging
async function logCurrentDay() {
  const now = new Date();
  const today = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
  return await logDailyCounterToCSV(today, dailyCounter);
}

// Add keyboard shortcut to manually log current day (Cmd+L on Mac)
document.addEventListener('keydown', async (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'l') {
    event.preventDefault();
    console.log('Manual logging triggered...');
    const success = await logCurrentDay();
    if (success) {
      console.log('Current day logged successfully!');
    }
  }
});

updateTimerDisplay();
loadDailyCounter();
displayTodayDate();
initializeLogging();
