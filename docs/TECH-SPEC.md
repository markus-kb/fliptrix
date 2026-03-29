# **Project Specification: Cross-Platform “Fake Screensaver” (Tauri-Based)**

## **1. Objective**

Develop a **cross-platform desktop application** that mimics the behavior of a traditional screensaver without requiring system-level integration or administrative privileges.

The application should:

* Automatically launch after a defined period of user inactivity
* Run as a **fullscreen, borderless overlay**
* Exit immediately upon user interaction (mouse/keyboard)
* Be deployable without installation or elevated permissions

---

## **2. Target Platforms**

### **Primary Target**

* **Windows 11 (user-level execution, no admin rights)**

### **Secondary Target**

* **Linux (Ubuntu)**

  * Used primarily for **development and testing**
  * Functional parity with Windows expected where feasible

---

## **3. Technology Stack**

### **Core Framework**

* Tauri

### **Frontend**

* HTML / CSS / JavaScript (framework optional: Astro, or vanilla)

### **Backend (Tauri Core)**

* Rust (minimal usage; primarily for system integration if needed)

---

## **4. High-Level Architecture**

```text
[ Idle Monitor Process ]
        ↓ (user inactive for N minutes)
[ Launch Screensaver App ]
        ↓
[ Fullscreen Overlay Window ]
        ↓ (user input detected)
[ Immediate Exit ]
```

### **Separation of Concerns**

* **Idle Monitor**: Detects inactivity and triggers launch
* **Screensaver App**: Handles rendering and interaction

---

## **5. Functional Requirements**

### **5.1 Idle Detection**

* Detect system-wide user inactivity (mouse + keyboard)
* Configurable timeout (default: 5 minutes)
* Must not require admin privileges

### **5.2 Screensaver Launch**

* Trigger application launch when idle threshold is exceeded
* Prevent multiple concurrent instances

### **5.3 Fullscreen Behavior**

* Borderless, fullscreen window
* Always-on-top (topmost)
* Covers all active displays (multi-monitor support preferred)
* Cursor hidden while active

### **5.4 Exit Conditions**

* Exit immediately on:

  * Keyboard input
  * Mouse movement (with configurable threshold to avoid noise)
* Restore system to prior state without artifacts

### **5.5 Autostart (Optional but Recommended)**

* Launch idle monitor on user login
* Must be implemented **without admin rights**

  * Windows: user Startup folder
  * Linux: user-level autostart (e.g. `.config/autostart`)

---

## **6. Non-Functional Requirements**

### **6.1 No Admin Rights**

* Entire solution must operate in **user space**
* No writes to protected system directories
* No system-level screensaver registration

### **6.2 Performance**

* Low CPU usage while idle monitoring
* Efficient rendering (avoid unnecessary GPU/CPU load)

### **6.3 Stability**

* No crashes on rapid input / exit
* Graceful handling of multiple monitors and resolution changes

### **6.4 Portability**

* Same codebase for Windows and Linux
* Platform-specific logic isolated where necessary

---

## **7. Multi-Monitor Support**

* Detect all connected displays
* Either:

  * Single window spanning all displays, or
  * One window per display
* No visible gaps or window borders

---

## **8. Security Constraints**

* No elevated privileges
* No background services requiring installation
* No invasive system hooks

---

## **9. Out of Scope**

* Native OS screensaver integration (`.scr` on Windows)
* System-level idle hooks requiring admin access
* Screen locking / authentication mechanisms
* Enterprise device management integration

---

## **11. Success Criteria**

* App launches reliably after inactivity
* Fullscreen overlay behaves identically to a native screensaver
* Immediate and clean exit on user input
* Works on Windows (production) and Linux (development/testing)
