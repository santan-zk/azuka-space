# Azuka-space

A responsive student portfolio and academic planner built with plain HTML, CSS and JavaScript. No frameworks, no build step, no backend.

Course: COS 106, Introduction to Web Technologies, MIVA Open University
Student: Obi Chidera Azuka, Computer Science, 100 Level

## Pages

- Home: introduction, portrait, links to Projects and About
- About: background, skills, interests
- Projects: OYA Creative (featured), plus a bubble sort visualiser
- Academic Planner: courses, tasks, deadlines, exam countdowns, time tracking, heat graph, JSON export/import
- Contact: validated form that sends through Formspree

## Features

- Dark, responsive design with a mobile menu
- Command palette (Ctrl+K or Cmd+K)
- Planner data saved in the browser with localStorage
- Self-hosted fonts (Archivo, Inter, JetBrains Mono, SIL Open Font License)
- Keyboard accessible, respects reduced-motion settings

## Run locally

Open `index.html` in a browser, or run `python3 -m http.server 8000` in this folder and visit http://localhost:8000.

## Project structure

index.html, about.html, projects.html, planner.html, contact.html
css/style.css
js/ (one script per feature)
assets/ (fonts, images, icons)
tests/ (unit, contrast and browser tests)

## Notes

- Planner data stays in your own browser and does not sync between devices. Use Export (JSON) to back it up.

## Author

Obi Chidera Azuka
