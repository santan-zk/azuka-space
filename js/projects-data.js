/*
 * projects-data.js — the only file you edit to add projects.
 *
 * NS.projects        Your real projects. Empty on purpose until there is real work to show.
 * NS.exampleProjects One clearly labelled example, used only by the "Preview the layout" button.
 *                    Delete it whenever you like; the page does not depend on it.
 *
 * To add a project, copy the template below into NS.projects. Every field is optional except
 * `name`; a field you leave out simply does not appear. Links must start with https://.
 *
 *   {
 *     name: 'Project name',
 *     status: 'In progress',            // e.g. Idea, In progress, Finished
 *     summary: 'One sentence on what it is.',
 *     problem: 'What problem or question started it.',
 *     approach: 'How you went about it.',
 *     contribution: 'What you personally did (say so if it was a team project).',
 *     tech: ['Rust', 'JavaScript'],
 *     images: [{ src: 'assets/images/my-project.png', width: 1400, height: 700, alt: 'What the screenshot shows', caption: 'Optional' }], // width and height are optional but stop the page jumping as images load
 *     repoUrl: 'https://github.com/your-name/your-repo',
 *     demoUrl: 'https://your-demo-link',
 *     lessons: 'What you learned or what comes next.'
 *   }
 */
window.NS = window.NS || {};

NS.projects = [
  {
    name: 'OYA Creative',
    status: 'Live',
    summary: 'A multidisciplinary creative portfolio, live now. It currently shows two projects, a 10-photograph collection for the streetwear brand N2P (nth2prove) and a 37-second skate video.',
    approach: 'Big type, a plain light background and a monospace label style, so the work carries the page. Home, Work, About and Contact pages. Hosted on Vercel.',
    contribution: 'I built the site together with Claude as my assistant. On the N2P collection shown on it, my roles are creative direction, concept development and overall visual direction.',
    images: [
      { src: 'assets/images/oya-home.jpg', width: 1400, height: 703, alt: 'The OYA Creative homepage: the word OYA in very large black letters on a light background, with the navigation Home, Work, About and Contact above it.', caption: 'OYA Creative homepage' },
      { src: 'assets/images/oya-work.jpg', width: 1400, height: 700, alt: 'The OYA Creative page for the N2P promotional collection, with the title N2P in large black letters and a list of roles: creative direction, concept development and overall visual direction.', caption: 'The N2P case page on OYA Creative' }
    ],
    demoUrl: 'https://oyacreative.vercel.app/'
  }
];

NS.exampleProjects = [
  {
    name: 'Example entry: your project name',
    status: 'Example only',
    summary: 'This is where a one-sentence description of the project goes.',
    problem: 'This is where you explain the problem or question that started the project.',
    approach: 'This is where you describe how you went about solving it, and the decisions you made along the way.',
    contribution: 'This is where you say exactly what you did yourself. If it was a team project, name your part.',
    tech: ['Technology one', 'Technology two'],
    lessons: 'This is where lessons learned and next steps go.'
  }
];
