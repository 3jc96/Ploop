# App Store Submission Checklist

Use this when filling out App Store Connect.

---

## 1. Copyright Information
**In app.json:** `© 2025 Ploop` (already added)

**In App Store Connect:** App Information → Copyright → enter `© 2025 Ploop` (or `© 2025 [Your Name]` if you prefer)

---

## 2. Content Rights Information
**Where:** App Store Connect → Your App → App Information → Content Rights

**What to do:** Answer the questions:
- **Do you own or have rights to all content?** → Yes (you built the app)
- **Does your app contain third-party content?** → Yes (user-generated reviews, Google Maps)
- **Do you have rights to use that content?** → Yes (users grant rights by submitting; Google/Apple have their own terms)

---

## 3. Primary Category
**Where:** App Store Connect → App Information → Category

**Recommended:** **Utilities** (toilet finder) or **Navigation** (map-based)

Avoid **Games** as primary—that can trigger the Game Center requirement. Ploop is a utility with a mini-game, not a game app.

---

## 4. Game Center Key
**If you chose "Utilities" or "Navigation" as primary:** You likely won't see this requirement. Ignore it.

**If you chose "Games":** Switch primary category to **Utilities** or **Navigation** to avoid needing Game Center.

**If Apple still requires it:** You’d add the Game Center capability in Xcode. Since Ploop uses its own leaderboard (not Apple Game Center), you generally don’t need it.

---

## 5. Price Tier
**Where:** App Store Connect → Pricing and Availability

**Recommended:** **Free** (most toilet finders are free)

---

## 6. Age Ratings
**Where:** App Store Connect → App Information → Age Rating → Edit

Answer the questionnaire. For Ploop (toilet finder, no violence, no mature content):
- Cartoon/Fantasy Violence: None
- Realistic Violence: None
- Sexual Content: None
- Profanity: None
- Horror/Fear: None
- Mature/Suggestive: None
- Gambling: None
- Unrestricted Web Access: No (or Yes if you open external links)
- Gambling/Contests: None
- etc.

Result should be **4+** or **All Ages**.

---

## 7. English (U.S.) Description
**Where:** App Store Connect → App Store → [Your Version] → Description

**Copy-paste this:**

```
Find clean toilets nearby—fast.

Ploop helps you discover and review public toilets near you. See ratings for cleanliness and smell, check amenities (bidet, wheelchair access, free entry), and get directions.

• Map view – Browse toilets on an interactive map
• Reviews – Rate toilets and read what others say
• Filters – Bidet only, wheelchair accessible, free only
• Save favorites – Build your go-to list
• Add toilets – Contribute new spots for the community
• Mini-game – Catch the poop and compete on the leaderboard

Sign in with Google or Apple to save your reviews and favorites. No account needed to browse.
```

---

## Summary
| Item | Action |
|------|--------|
| Copyright | `© 2025 Ploop` |
| Content Rights | Complete in App Information |
| Primary Category | **Utilities** or **Navigation** |
| Game Center | Avoid by not using Games as primary |
| Price | **Free** |
| Age Rating | Complete questionnaire → 4+ |
| Description | Use text above |
