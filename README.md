# Football Community Platform ⚽🇳🇬

A digital platform connecting football players, fans, teams, venue owners, and tournament organisers across Lagos, Nigeria.

> **Live Interactive Preview:** [https://sazzy97.github.io/Football-Community/](https://sazzy97.github.io/Football-Community/)

---

## 📱 Features & Highlights

The platform integrates four core experiences:
1. **PLAY:** Pitch discovery, real-time availability calendar, full-pitch bookings (with slot-hold timers and full/deposit payment options), and open-match slot bookings.
2. **WATCH:** Grassroots competitions, tournament schedules, live match centre with score updates, and digital entry pass tickets (with turnstile QR verification).
3. **CONNECT:** Football identity, player profiles, squad rosters, captain/role management, and invitations.
4. **MANAGE:** Web dashboard interfaces for venue operators, tournament managers, and platform administrators.

---

## 🎨 Design System

The platform is designed with both **Light** and **Dark** experiences:

| Token | Light Theme | Dark Theme | Purpose |
|---|---|---|---|
| `--color-background` | `#F4F4F4` | `#0C130F` | Main background |
| `--color-surface` | `#FFFFFF` | `#15201A` | Cards & sheets |
| `--color-surface-muted` | `#E9F5EC` | `#1F2D25` | Input fills & badges |
| `--color-primary` | `#123D2B` | `#123D2B` | Brand green |
| `--color-accent` | `#B8F34A` | `#B8F34A` | Electric lime highlights |
| `--color-text-primary` | `#17211B` | `#F1F6F2` | Headings & primary labels |
| `--color-text-secondary` | `#455149` | `#B5C2BA` | Body & subtitles |
| `--color-text-muted` | `#87928A` | `#8FA096` | Captions & subtle icons |
| `--color-border` | `#E5EAE5` | `#263329` | Hairline dividers & borders |

---

## 📁 Repository Structure

```text
├── index.html            # Standalone interactive prototype with Light/Dark mode
├── README.md             # Project documentation & design system specs
├── img/                  # High-resolution Lagos football venue & match photos
│   ├── venue1.jpg        # Lekki Goal Arena (5-a-side floodlit astro turf)
│   ├── venue2.jpg        # Yaba Turf Club (Urban rooftop pitch)
│   ├── venue3.jpg        # Ikeja Sports Ground (11-a-side stadium grass)
│   ├── game1.jpg         # Thursday Night 5s open match
│   ├── event1.jpg        # Lagos Grassroots Cup Final (stadium action)
│   ├── event2.jpg        # Campus 7s match
│   ├── event3.jpg        # Community charity match
│   └── event4.jpg        # Youth academy trials
└── figma-plugin/         # Automated Figma Screen Generator
    ├── manifest.json     # Plugin manifest file
    └── code.js           # Auto-Layout & image generator script (18 screens)
```

---

## 🖌️ Running the Figma Generator Plugin

1. Open the **Figma desktop app** and create/open any canvas.
2. In the top-left menu, go to:  
   **Plugins** → **Development** → **Import plugin from manifest...**
3. Select `figma-plugin/manifest.json`.
4. Run the plugin. It will automatically generate all **18 screens** (9 Light and 9 Dark) directly on your canvas with real photos and Auto-Layout.

---

## 🚀 Live Preview Setup (GitHub Pages)

To view the interactive design directly in your browser:
1. Go to this repository's **Settings** tab on GitHub.
2. Under the **Code and automation** section on the left sidebar, click **Pages**.
3. Under **Branch**, select `main` and `/ (root)`.
4. Click **Save**.
5. Within 1 minute, your live preview will be available at:  
   👉 **`https://sazzy97.github.io/Football-Community/`**
