# VíaSetu Privacy & Security Guide

## Overview

VíaSetu includes comprehensive privacy protection features that automatically clean up your session data when you exit. This is especially important when using shared computers or public networks.

## Quick Start

### Accessing Privacy Settings
1. Log in to VíaSetu
2. Click the **shield icon (🛡️)** in the top toolbar
3. Configure your cleanup preferences
4. Click **Save Settings**

## Privacy Features

### Automatic Cleanup Options

#### 1. Clear on Logout
When enabled, clicking the "Logout" button will:
- End your server session
- Clear all cookies
- Wipe local storage
- Remove session storage
- Delete cached data
- Clear IndexedDB databases
- Attempt to clear browser history

**Recommended for:** All users, especially on shared computers

#### 2. Clear on Tab/Browser Close
When enabled, closing the VíaSetu tab or browser will:
- Automatically trigger cleanup
- Send logout beacon to server
- Clear all local data
- Remove session traces

**Recommended for:** Public computers, shared devices

### Data Types You Can Clear

| Data Type | What It Includes | Impact if Cleared |
|-----------|-----------------|-------------------|
| **Cookies** | Session tokens, authentication | Logs you out immediately |
| **Local Storage** | Persistent app data | Removes saved preferences |
| **Session Storage** | Temporary session data | Clears current session info |
| **Cache** | Downloaded files, API responses | May slow down next visit |
| **Browser History** | Recent page navigation | Limited clearing capability |
| **IndexedDB** | Structured data storage | Removes any cached file info |

## Security Scenarios

### Scenario 1: Personal Computer at Home
**Configuration:**
- ✅ Clear on Logout: Enabled
- ❌ Clear on Tab Close: Disabled
- ✅ Clear: Cookies, Session Storage
- ❌ Clear: Local Storage, Cache, History

**Why:** You control the device, so aggressive cleanup isn't necessary. Keep preferences for convenience.

### Scenario 2: Shared Office Computer
**Configuration:**
- ✅ Clear on Logout: Enabled
- ✅ Clear on Tab Close: Enabled
- ✅ Clear: Everything

**Why:** Maximum privacy. Others may use this computer, so leave no traces.

### Scenario 3: Public Computer / Internet Café
**Configuration:**
- ✅ Clear on Logout: Enabled
- ✅ Clear on Tab Close: Enabled
- ✅ Clear: Everything
- **PLUS:** Use "Clear All Data Now" button before leaving

**Why:** Highest risk environment. Clear everything and verify manually.

### Scenario 4: Enterprise/Corporate Network
**Configuration:**
- Follow your organization's data retention policies
- Consult IT department for recommended settings
- Consider compliance requirements

**Why:** Corporate policies may require specific data handling.

## Manual Controls

### Clear All Data Now
The **"Clear All Data Now"** button in the privacy settings allows you to:
- Immediately wipe all session data
- Force logout
- Verify cleanup completion

**Use this when:**
- You're on a public computer and about to leave
- You want to verify cleanup is working
- You need to troubleshoot session issues
- You're switching accounts

## Technical Details

### What Gets Cleared Exactly

#### Cookies
```
All cookies for the current domain including:
- Session cookies
- Authentication tokens
- Preference cookies
```

#### Local Storage
```
localStorage.clear()
Removes all key-value pairs including:
- App preferences
- Cached settings
- Privacy configuration (saved separately)
```

#### Session Storage
```
sessionStorage.clear()
Removes all temporary session data
```

#### Cache
```
Uses Cache API to delete:
- All cache storage instances
- Service worker caches (if any)
- Cached API responses
```

#### IndexedDB
```
Deletes all IndexedDB databases:
- File metadata caches
- Offline storage
- Structured data
```

#### Browser History
```
Limited capability:
- Replaces current state
- Cannot clear entire browser history (browser security restriction)
- Only affects current page navigation state
```

### Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Cookie Clearing | ✅ | ✅ | ✅ | ✅ |
| Storage Clearing | ✅ | ✅ | ✅ | ✅ |
| Cache API | ✅ | ✅ | ✅ | ✅ |
| IndexedDB Deletion | ✅ | ✅ | ✅ | ✅ |
| History Clearing | ⚠️ Limited | ⚠️ Limited | ⚠️ Limited | ⚠️ Limited |
| beforeunload | ✅ | ✅ | ✅ | ✅ |

**Note:** History clearing is limited by browser security policies. No web application can fully clear browser history.

## Event Triggers

### When Cleanup Happens

1. **User Clicks Logout**
   - Calls `/api/auth/logout`
   - Runs cleanup functions
   - Redirects to login

2. **User Closes Tab** (if enabled)
   - `beforeunload` event fires
   - Sends logout beacon
   - Clears storage synchronously

3. **Browser Closes** (if enabled)
   - Similar to tab close
   - May have platform differences

4. **Manual Trigger**
   - User clicks "Clear All Data Now"
   - Immediate full cleanup
   - Confirmation dialog shown

## Verification

### How to Verify Cleanup Worked

1. **Chrome DevTools:**
   - Open DevTools (F12)
   - Go to Application tab
   - Check Storage sections
   - All should be empty after cleanup

2. **Firefox Developer Tools:**
   - Open Developer Tools (F12)
   - Go to Storage tab
   - Verify empty storage

3. **Console Logs:**
   - Check browser console
   - Look for `[VíaSetu] Browser data cleared successfully`

## Troubleshooting

### Cleanup Not Working?

**Problem:** Data still present after logout
**Solutions:**
1. Check that cleanup options are enabled in settings
2. Verify browser supports Cache API and IndexedDB
3. Try "Clear All Data Now" button
4. Manually clear browser data via browser settings

**Problem:** Settings not saving
**Solutions:**
1. Ensure cookies/storage aren't blocked
2. Check browser permissions
3. Try saving again after clearing data

**Problem:** Auto-cleanup on tab close not working
**Solutions:**
1. Browser may block `beforeunload` in some cases
2. Use manual logout instead
3. Enable "Clear All Data Now" before closing

## Security Best Practices

### ✅ DO:
- Enable all cleanup options on public/shared computers
- Manually verify cleanup in sensitive situations
- Use strong, unique passwords
- Log out explicitly before closing tabs
- Test your privacy settings regularly

### ❌ DON'T:
- Rely solely on browser incognito mode
- Leave VíaSetu open and unattended
- Share login credentials
- Disable cleanup on public computers
- Assume history clearing is complete

## Privacy Notice

**What VíaSetu Can Clear:**
- Client-side data (cookies, storage, cache)
- Current session authentication
- Local file metadata cache

**What VíaSetu Cannot Clear:**
- Server-side logs (controlled by server admin)
- Network traffic logs (controlled by network admin)
- Complete browser history (browser security restriction)
- Operating system clipboard
- Downloaded files on disk

**Server-Side Security:**
- Session tokens are invalidated on logout
- Server maintains its own session cleanup
- Audit logs may be kept per server policy

## Support

For issues or questions about privacy features:
1. Check this guide first
2. Verify browser compatibility
3. Test in a private/incognito window
4. Report persistent issues to your system administrator

---

**Remember:** Privacy cleanup is a security layer, not a guarantee. Always follow your organization's security policies and best practices for handling sensitive data.