# Nordic Car Landing Page — Specification

## Concept & Vision

A serene, premium landing page for a fictional Nordic electric vehicle brand "NORD" (Nordic Original Design). The page embodies Scandinavian design philosophy: minimalism, functional beauty, connection to nature, and understated luxury. The experience feels like stepping into a calm winter showroom — clean, spacious, and thoughtfully curated.

## Design Language

### Aesthetic Direction
Inspired by Scandinavian minimalism — IKEA's simplicity meets Volvo's heritage. Clean geometric forms, generous whitespace, photography-forward layouts, and a sense of calm sophistication.

### Color Palette
- **Primary**: `#1A1A2E` (deep Nordic night)
- **Secondary**: `#F7F9FB` (arctic snow)
- **Accent**: `#7DD3C0` (aurora teal)
- **Background**: `#FAFAFA` (clean white)
- **Text Primary**: `#1A1A2E`
- **Text Secondary**: `#6B7280`
- **Highlight**: `#E8F4F2` (soft mint tint)

### Typography
- **Headlines**: "Cormorant Garamond" (elegant serif, Scandinavian editorial feel)
- **Body**: "Karla" (clean, geometric sans-serif with Nordic character)
- **Accent**: "DM Sans" (modern, functional)

### Spatial System
- Base unit: 8px
- Section padding: 120px vertical on desktop
- Max content width: 1200px
- Generous whitespace — let elements breathe

### Motion Philosophy
- Subtle, purposeful animations that feel natural
- Fade-in with slight upward drift on scroll (200ms, ease-out)
- Smooth hover transitions (300ms)
- No flashy effects — motion serves clarity

### Visual Assets
- Hero: Full-bleed atmospheric car image (using Unsplash Nordic/winter automotive)
- Icons: Custom minimal SVG icons matching Scandinavian aesthetic
- Decorative: Subtle gradient overlays, geometric accents

## Layout & Structure

### Page Flow
1. **Hero Section** — Full viewport, dramatic car reveal with tagline
2. **Brand Philosophy** — Three pillars of Nordic design with icons
3. **Feature Showcase** — Large imagery with floating feature cards
4. **Specs Grid** — Technical specifications in elegant grid
5. **Experience CTA** — Invitation to learn more with ambient background
6. **Footer** — Minimal, functional navigation

### Responsive Strategy
Desktop-first design optimized for 1440px. Maintains visual impact at 1024px+. Not mobile-optimized (user requested desktop).

## Features & Interactions

### Hero Section
- Full-screen atmospheric image with gradient overlay
- Centered headline with staggered letter reveal on load
- Subtle parallax on scroll
- CTA button with hover glow effect

### Feature Cards
- Float beside images
- Fade in on scroll intersection
- Icon + title + description format

### Specs Grid
- 2x3 grid of specification cards
- Hover: subtle lift with shadow increase
- Number display with accent color

### CTA Section
- Ambient gradient background
- Email capture form with minimal styling
- Submit button with loading state

## Component Inventory

### Navigation
- Fixed top bar, transparent initially
- Logo left, minimal nav links right
- Blur background on scroll

### Hero
- Full viewport height
- Background image with overlay gradient
- Headline, subheadline, CTA button

### Feature Card
- Icon (SVG), title, description
- Border-radius: 16px
- Background: white with subtle shadow
- States: default, hover (lift + shadow)

### Spec Card
- Large number, label, unit
- Accent underline
- States: default, hover

### Button (Primary)
- Background: aurora teal accent
- Text: deep night
- Padding: 16px 32px
- Border-radius: 8px
- Hover: slight glow, lift

### Button (Secondary)
- Transparent with border
- Border: deep night
- Hover: fill with deep night, white text

### Input Field
- Minimal border-bottom style
- Placeholder: secondary text color
- Focus: accent underline

### Footer
- Three columns: brand, links, social
- Minimal divider line
- Copyright at bottom

## Technical Approach

- Single HTML file with embedded CSS and JavaScript
- Vanilla JS for scroll animations and interactions
- Google Fonts: Cormorant Garamond, Karla, DM Sans
- CSS custom properties for theming
- Intersection Observer for scroll-triggered animations
- No frameworks or build tools needed
