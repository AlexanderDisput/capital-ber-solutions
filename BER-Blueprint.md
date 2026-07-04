# Master Implementation Blueprint: Capital BER Solutions
**Target Platform:** GitHub Pages (Static Site HTML/CSS/JS)
**Primary Goal:** Fast-loading, highly-converting, local SEO-optimized, and Google Ads-ready website for an SEAI Registered BER Assessor in Dublin.

---

## 1. Directory Architecture (Clean URLs)
Initialize the project with the following folder structure to support clean trailing-slash URLs (e.g., `capitalbersolutions.ie/about/`):

├── index.html (Homepage)
├── ber-assessor-dublin/
│   └── index.html (Transactional Service Hub)
├── ber-certificate-dublin/
│   └── index.html (Educational/FAQ Resource)
├── ber-for-selling-house/
│   └── index.html (Targeted: Property Sellers)
├── ber-for-rental-property/
│   └── index.html (Targeted: Landlords)
├── about/
│   └── index.html (Geo-Targeting & Corporate Bio)
├── css/
│   └── styles.css
└── js/
    └── main.js

---

## 2. Global Component Requirements (Apply to ALL pages)

### A. Google Tag Manager (GTM)
- **`<head>` tag:** Insert GTM script placeholder (Use ID: `GTM-XXXXXXX`) as high as possible.
- **`<body>` tag:** Insert GTM `<noscript>` iframe immediately after opening body tag.

### B. E-E-A-T Footer (Experience, Expertise, Authoritativeness, Trust)
Build a universal footer containing:
- Text: "SEAI Registration Number: [Insert Assessor Number Here]"
- [cite_start]Text: "Based in Sutton, Dublin 13. Serving Dublin and North Dublin." [cite: 55]
- Graphic placeholders for Corporate Insurance Logos (Professional Indemnity & Public Liability) and SEAI Assessor Badges.
- Global Navigation Links to all internal pages.

---

## 3. Page-by-Page Content & SEO Specifications

### Page 1: Homepage (`/index.html`)
- **H1 Headline:** SEAI Registered BER Assessor Dublin | [cite_start]Fast 24-48 Hour Turnaround [cite: 1, 2]
- [cite_start]**Value Prop:** Fast, professional, and accurate energy ratings for homeowners, landlords, and estate agents across the capital[cite: 3, 4, 5].
- [cite_start]**Core Services [cite: 6][cite_start]:** Sale & Rental BER [cite: 7][cite_start], Grant Compliance [cite: 9][cite_start], Advisory Reports[cite: 11].
- [cite_start]**The BER Journey [cite: 13][cite_start]:** 1. Instant Quote & Booking [cite: 14][cite_start], 2. On-Site Assessments [cite: 16][cite_start], 3. Certification & Report[cite: 19].
- **Tracking CTAs:** - Quote Form ID: `quote-enquiry-form` (Action: `YOUR_FORMSPREE_ENDPOINT`). Fields: Name, Email, Phone, Eircode, Property Type.
  - Phone Link ID: `hero-phone-btn`.
  - WhatsApp Link: `https://wa.me/353XXXXXXXXX` with ID `whatsapp-widget-click`.

### Page 2: Service Hub (`/ber-assessor-dublin/index.html`)
- **SEO Title:** BER Assessor Dublin | SEAI Registered Assessor
- **Meta Description:** Looking for a BER Assessor in Dublin? Capital BER Solutions provides fast, professional BER assessments across Dublin and North Dublin.
- [cite_start]**H1 Headline:** Professional SEAI Registered BER Assessor in Dublin [cite: 28, 30]
- **Content:** Layout our 4 distinct services (Residential BER, SEAI Grant Pre/Post-Works, Green Mortgage Audit, Technical Advisor Survey).
- **Internal Links (Anchor text):** "BER Certificate" -> `/ber-certificate-dublin/`, "selling a property" -> `/ber-for-selling-house/`, "renting a property" -> `/ber-for-rental-property/`, "Dublin 13" -> `/ber-dublin-13/`, "About Us" -> `/about/`.

### Page 3: Educational Hub (`/ber-certificate-dublin/index.html`)
*Note: This page exists to resolve keyword cannibalization. It must be strictly educational.*
- **SEO Title:** BER Certificate Dublin | Fast BER Assessments
- **Meta Description:** Need a BER Certificate in Dublin? Capital BER Solutions provides fast, professional BER assessments across Dublin with rapid turnaround.
- **H1 Headline:** Understanding Your BER Certificate in Dublin
- [cite_start]**Content:** FAQs on validity periods [cite: 89][cite_start], retrieving lost numbers, required documentation [cite: 152][cite_start], and what assessors check during the 45-90 minute visit[cite: 37, 81].
- **Internal Links:** "BER Assessor Dublin" -> `/ber-assessor-dublin/`.

### Page 4: Selling a House (`/ber-for-selling-house/index.html`)
- **SEO Title:** BER for Selling a House | Dublin BER Assessments
- **Meta Description:** Selling your house in Dublin? Capital BER Solutions provides fast, professional BER assessments with rapid turnaround throughout Dublin and North Dublin.
- **H1 Headline:** Selling Your House? [cite_start]You Will Usually Need a BER Certificate [cite: 99-101]
- [cite_start]**Content:** Explain Irish legislation requires valid BER before advertising[cite: 109, 110]. [cite_start]Emphasize fast 24-48 hr turnaround[cite: 124, 126].
- **Internal Links:** "BER Assessor Dublin", "BER Certificate Dublin", "Dublin 13", "About Us".

### Page 5: Rental Properties (`/ber-for-rental-property/index.html`)
- **SEO Title:** BER for Rental Property Dublin | BER for Landlords
- **Meta Description:** Need a BER for a rental property in Dublin? Capital BER Solutions provides fast BER assessments for landlords, investors and property managers.
- [cite_start]**H1 Headline:** BER Certificates for Rental Properties in Dublin [cite: 179-180]
- [cite_start]**Content:** Focus on minimizing vacancy periods for landlords and investors [cite: 194-195].
- **Internal Links:** "BER Certificate Dublin", "BER Assessor Dublin", "BER for Selling a House", "About Us".

### Page 6: About & Geo-Targeting (`/about/index.html`)
- **SEO Title:** About Capital BER Solutions | BER Assessor Dublin
- **Meta Description:** Learn more about Capital BER Solutions, a professional SEAI Registered BER Assessor serving Dublin and North Dublin with fast, reliable BER assessments.
- [cite_start]**H1 Headline:** Professional BER Assessments Across Dublin [cite: 197-198]
- [cite_start]**Content:** "Meet Luke" bio[cite: 203]. [cite_start]5 Core Principles: Professionalism [cite: 214][cite_start], Reliability [cite: 217][cite_start], Technical Accuracy [cite: 220][cite_start], Communication [cite: 222][cite_start], Customer Service[cite: 224]. 
- [cite_start]**Geo-Targeting Grid:** Sutton, Bayside, Howth, Baldoyle, Raheny, Kilbarrack, Donaghmede, Clontarf, Artane, Beaumont, Malahide, Portmarnock, Swords, Santry, Dublin 13 [cite: 242-256].

---

## 4. CSS / Design System (`css/styles.css`)
- **Colors:** Deep Slate (`#1E293B`), Emerald Green (`#10B981`), Amber/Gold (`#F59E0B`) strictly for tracking conversion buttons.
- **Typography:** Modern, clean sans-serif (Inter/system-ui).
- **Layout:** Mobile-first, responsive flexbox/grid. Clean form UI with drop-shadows. Sticky WhatsApp widget in the bottom corner.

---

## 5. Developer Instructions for Claude Code
Please generate the complete HTML, CSS, and JS files according to this document. Ensure semantic HTML5 tags are used throughout, all internal links use relative paths, and all tracking IDs (form IDs, button IDs) are strictly adhered to for Google Tag Manager integrations.