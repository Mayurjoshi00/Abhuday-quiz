const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

// ──────────────────────────────
//  IN-MEMORY STATE  (survives refreshes)
// ──────────────────────────────
const ADMIN_PASSWORD = 'chmod777';

const TEAM_CREDENTIALS = [
  { id: 'TEAM01', pass: 'hawk#9271', name: 'Team Alpha'   },
  { id: 'TEAM02', pass: 'upsd@5583', name: 'Team Beta'    },
  { id: 'TEAM03', pass: 'gate!7734', name: 'Team Gamma'   },
  { id: 'TEAM04', pass: 'mind$4421', name: 'Team Delta'   },
  { id: 'TEAM05', pass: 'demo%8812', name: 'Team Epsilon' },
  { id: 'TEAM06', pass: 'flux&3390', name: 'Team Zeta'    },
  { id: 'TEAM07', pass: 'labs*6617', name: 'Team Eta'     },
  { id: 'TEAM08', pass: 'vine!2245', name: 'Team Theta'   },
  { id: 'TEAM09', pass: 'will@7753', name: 'Team Iota'    },
  { id: 'TEAM10', pass: 'elev#3381', name: 'Team Kappa'   },
];

// teamId -> { id, name, submitted, answers, startedAt, usedSeconds,
//             questionOrder, tabSwitchCount, lastActive, sessionToken }
const teamState = new Map();

// WebSocket clients: { ws, role, teamId }
const wsClients = new Set();

// ──────────────────────────────
//  HELPERS
// ──────────────────────────────
function broadcast(data, filter) {
  const msg = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (filter && !filter(client)) continue;
    client.ws.send(msg);
  }
}

function broadcastToAdmins(data) {
  broadcast(data, c => c.role === 'admin');
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getPublicState(team) {
  if (!team) return null;
  return {
    id: team.id, name: team.name, submitted: team.submitted,
    pct: team.pct || 0, correct: team.correct || 0, wrong: team.wrong || 0,
    skip: team.skip || 0, eC: team.eC || 0, mC: team.mC || 0, hC: team.hC || 0,
    usedSeconds: team.usedSeconds || 0, startedAt: team.startedAt,
    tabSwitchCount: team.tabSwitchCount || 0, members: team.members || '',
    lastActive: team.lastActive
  };
}

// ──────────────────────────────
//  AUTH ROUTES
// ──────────────────────────────
app.post('/api/team/login', (req, res) => {
  const { teamId, pass, members } = req.body;
  const id = (teamId || '').trim().toUpperCase();
  const cred = TEAM_CREDENTIALS.find(c => c.id === id && c.pass === pass);
  if (!cred) return res.status(401).json({ error: 'Invalid credentials' });

  let state = teamState.get(id);
  if (state && state.submitted) {
    return res.status(403).json({ error: 'This team has already submitted the quiz.' });
  }

  const sessionToken = uuidv4();
  if (!state) {
    // Fresh start — randomise question order within each section
    const easyIdx  = shuffleArray([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14]);
    const medIdx   = shuffleArray([15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44]);
    const hardIdx  = shuffleArray([45,46,47,48,49,50,51,52,53,54,55,56,57,58,59]);
    const questionOrder = [...easyIdx, ...medIdx, ...hardIdx];
    state = {
      id, name: cred.name, members: members || '',
      submitted: false, startedAt: Date.now(),
      answers: new Array(60).fill(null), flags: new Array(60).fill(false),
      totalSeconds: 38 * 60, usedSeconds: 0,
      questionOrder, tabSwitchCount: 0, sessionToken, lastActive: Date.now()
    };
    teamState.set(id, state);
    broadcastToAdmins({ type: 'TEAM_JOINED', team: getPublicState(state) });
  } else {
    state.sessionToken = sessionToken;
    state.lastActive = Date.now();
    if (members) state.members = members;
  }

  res.json({
    sessionToken,
    questionOrder: state.questionOrder,
    answers: state.answers,
    flags: state.flags,
    totalSeconds: state.totalSeconds,
    usedSeconds: state.usedSeconds,
    teamName: state.name,
    teamId: id
  });
});

app.post('/api/admin/login', (req, res) => {
  const { pass } = req.body;
  if (pass === ADMIN_PASSWORD) {
    res.json({ ok: true, adminToken: 'admin_' + ADMIN_PASSWORD });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

// ──────────────────────────────
//  QUIZ STATE ROUTES
// ──────────────────────────────
function authTeam(req, res) {
  const { teamId, sessionToken } = req.body;
  const id = (teamId || '').toUpperCase();
  const state = teamState.get(id);
  if (!state || state.sessionToken !== sessionToken) {
    res.status(401).json({ error: 'Unauthorized' }); return null;
  }
  return state;
}

// Save answer
app.post('/api/quiz/answer', (req, res) => {
  const state = authTeam(req, res); if (!state) return;
  const { qIndex, answer } = req.body;
  if (state.submitted) return res.status(400).json({ error: 'Already submitted' });
  state.answers[qIndex] = answer;
  state.lastActive = Date.now();
  res.json({ ok: true });
});

// Save flag
app.post('/api/quiz/flag', (req, res) => {
  const state = authTeam(req, res); if (!state) return;
  const { qIndex, flagged } = req.body;
  if (state.submitted) return res.status(400).json({ error: 'Already submitted' });
  state.flags[qIndex] = flagged;
  res.json({ ok: true });
});

// Heartbeat — keeps timer in sync
app.post('/api/quiz/heartbeat', (req, res) => {
  const state = authTeam(req, res); if (!state) return;
  const { usedSeconds, totalSeconds } = req.body;
  if (!state.submitted) {
    state.usedSeconds = usedSeconds;
    state.totalSeconds = totalSeconds;
    state.lastActive = Date.now();
  }
  res.json({ ok: true });
});

// Tab switch event
app.post('/api/quiz/tabswitch', (req, res) => {
  const state = authTeam(req, res); if (!state) return;
  if (state.submitted) return res.json({ ok: true });
  state.tabSwitchCount = (state.tabSwitchCount || 0) + 1;
  const event = {
    type: 'TAB_SWITCH',
    teamId: state.id,
    teamName: state.name,
    count: state.tabSwitchCount,
    timestamp: Date.now()
  };
  broadcastToAdmins(event);
  res.json({ ok: true, count: state.tabSwitchCount });
});

// Submit quiz
app.post('/api/quiz/submit', (req, res) => {
  const state = authTeam(req, res); if (!state) return;
  if (state.submitted) return res.status(400).json({ error: 'Already submitted' });

  const { usedSeconds } = req.body;
  state.usedSeconds = usedSeconds || state.usedSeconds;
  state.submitted = true;
  state.submittedAt = Date.now();

  // Calculate scores using original question indices mapped back
  const QUESTIONS_FLAT = getAllQuestions();
  let correct = 0, eC = 0, mC = 0, hC = 0;
  state.questionOrder.forEach((origIdx, orderPos) => {
    const q = QUESTIONS_FLAT[origIdx];
    const ans = state.answers[orderPos];
    if (ans === q.ans) {
      correct++;
      if (origIdx < 15) eC++;
      else if (origIdx < 45) mC++;
      else hC++;
    }
  });
  const wrong = state.answers.filter((a, i) => a !== null && a !== QUESTIONS_FLAT[state.questionOrder[i]].ans).length;
  const skip = state.answers.filter(a => a === null).length;
  const pct = Math.round(correct / 60 * 100);

  Object.assign(state, { correct, wrong, skip, pct, eC, mC, hC });

  broadcastToAdmins({ type: 'TEAM_SUBMITTED', team: getPublicState(state) });

  res.json({ correct, wrong, skip, pct, eC, mC, hC, usedSeconds: state.usedSeconds });
});

// ──────────────────────────────
//  ADMIN ROUTES
// ──────────────────────────────
function authAdmin(req, res) {
  const token = req.headers['x-admin-token'];
  if (token !== 'admin_' + ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized' }); return false;
  }
  return true;
}

app.get('/api/admin/teams', (req, res) => {
  if (!authAdmin(req, res)) return;
  const teams = [...teamState.values()].map(getPublicState);
  res.json({ teams, credentials: TEAM_CREDENTIALS });
});

app.post('/api/admin/clear', (req, res) => {
  if (!authAdmin(req, res)) return;
  teamState.clear();
  broadcastToAdmins({ type: 'DATA_CLEARED' });
  res.json({ ok: true });
});

// ──────────────────────────────
//  WEBSOCKET
// ──────────────────────────────
wss.on('connection', (ws, req) => {
  const client = { ws, role: null, teamId: null };
  wsClients.add(client);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'AUTH_ADMIN' && msg.token === 'admin_' + ADMIN_PASSWORD) {
        client.role = 'admin';
        // Send current state snapshot
        ws.send(JSON.stringify({
          type: 'SNAPSHOT',
          teams: [...teamState.values()].map(getPublicState)
        }));
      } else if (msg.type === 'AUTH_TEAM') {
        const id = (msg.teamId || '').toUpperCase();
        const state = teamState.get(id);
        if (state && state.sessionToken === msg.sessionToken) {
          client.role = 'team';
          client.teamId = id;
        }
      }
    } catch {}
  });

  ws.on('close', () => wsClients.delete(client));
  ws.on('error', () => wsClients.delete(client));
});

// ──────────────────────────────
//  QUESTIONS DATA
// ──────────────────────────────
function getAllQuestions() {
  return [
  // SECTION A: EASY (0-14)
  {id:1,section:'easy',cat:'UX Fundamentals',text:'What does "UX" stand for?',opts:['User Experience','Universal Exchange','UI Extension','Unified Experience'],ans:0},
  {id:2,section:'easy',cat:'UX Fundamentals',text:'Which of the following best describes a wireframe?',opts:['A high-fidelity visual design with colors and images','A simple, skeletal layout showing structure without visual styling','A final prototype ready for developer handoff','A document listing all the features of an app'],ans:1},
  {id:3,section:'easy',cat:'UX Fundamentals',text:'What is a "persona" in design?',opts:['A visual prototype of an app','A fictional character representing a typical user, based on research','A color palette guide for a brand','A navigation menu pattern'],ans:1},
  {id:4,section:'easy',cat:'UX Fundamentals',text:'Which of these is a common UX design tool?',opts:['Microsoft Excel','Adobe Photoshop','Figma','Google Sheets'],ans:2},
  {id:5,section:'easy',cat:'UX Fundamentals',text:'What does "usability" mean in the context of a product?',opts:['How good the product looks','How easy and efficient the product is to use','How many features the product has','How fast the product loads'],ans:1},
  {id:6,section:'easy',cat:'Visual Design',text:'What is the main purpose of "white space" in a design?',opts:['To save ink when printing','To improve readability and reduce visual clutter','To fill unused parts of the screen','To separate the header from the footer'],ans:1},
  {id:7,section:'easy',cat:'Visual Design',text:'Which color model is used for digital screens?',opts:['CMYK','Pantone','RGB','HSL'],ans:2},
  {id:8,section:'easy',cat:'Visual Design',text:'Visual hierarchy in design refers to:',opts:['The order in which a user is likely to notice elements on a page','The ranking of employees on a design team','The alphabetical order of design principles','The loading order of images on a website'],ans:0},
  {id:9,section:'easy',cat:'Typography',text:'What is the key visual difference between serif and sans-serif fonts?',opts:['Serif fonts are digital; sans-serif are used in print','Serif fonts have small decorative strokes at the ends of letters; sans-serif do not','Serif fonts are always bold; sans-serif are always thin','Serif fonts are only used for headings'],ans:1},
  {id:10,section:'easy',cat:'Typography',text:'What does "line height" (leading) control in typography?',opts:['The thickness of each character stroke','The space between lines of text','The space between individual characters','The overall font size'],ans:1},
  {id:11,section:'easy',cat:'Color Theory',text:'Which colors are considered "complementary colors"?',opts:['Colors next to each other on the color wheel, like blue and green','Colors directly opposite each other on the color wheel, like red and green','Colors from the same family, like light blue and dark blue','Any two colors that appear in nature together'],ans:1},
  {id:12,section:'easy',cat:'Color Theory',text:'Why is color contrast important in UI design?',opts:['It makes pages load faster','It improves readability and accessibility, especially for users with visual impairments','It reduces the number of colors needed','It helps with grid alignment'],ans:1},
  {id:13,section:'easy',cat:'Design Process',text:'The Design Thinking process starts with which phase?',opts:['Define','Prototype','Empathize','Ideate'],ans:2},
  {id:14,section:'easy',cat:'Design Process',text:'What does MVP stand for in product design?',opts:['Most Valuable Product','Minimum Viable Product','Maximum Visual Performance','Master Visual Prototype'],ans:1},
  {id:15,section:'easy',cat:'Design Process',text:'What is "user testing" used for?',opts:['To test if the code runs correctly','To observe real users interacting with a design to find problems','To check if the design follows brand guidelines','To measure how fast a website loads'],ans:1},
  // SECTION B: MODERATE (15-44)
  {id:16,section:'medium',cat:'Interaction Design',text:"According to Fitts's Law, which button would be easier to click?",opts:['A small button far from the cursor','A large button close to the cursor','A small button close to the cursor',"Button size and distance don't matter"],ans:1},
  {id:17,section:'medium',cat:'Interaction Design',text:'What is a "microinteraction" in UI design?',opts:['An interaction on a very small screen',"A small, single-purpose moment in a product — like a 'like' button animation",'An interaction that takes less than one second','A gesture-based input on mobile'],ans:1},
  {id:18,section:'medium',cat:'Interaction Design',text:"\"Jakob's Law\" states that users prefer interfaces that:",opts:['Are as simple as possible with no distractions','Work the same way as other products they already use','Use the fewest number of clicks','Always put navigation at the top'],ans:1},
  {id:19,section:'medium',cat:'Interaction Design',text:'What is "progressive disclosure" in interaction design?',opts:['Showing all features and options at once to save time','Revealing information gradually so users only see what they need when they need it','Disclosing design decisions to clients in a presentation','A method for A/B testing two versions of an interaction'],ans:1},
  {id:20,section:'medium',cat:'Interaction Design',text:'The Gestalt "principle of proximity" states that:',opts:['Objects that look similar appear related','Objects close to each other appear grouped together','Simple shapes are always preferred over complex ones','Objects with the same color must be in the same category'],ans:1},
  {id:21,section:'medium',cat:'Heuristic Evaluation',text:'How many usability heuristics did Jakob Nielsen define?',opts:['7','10','12','15'],ans:1},
  {id:22,section:'medium',cat:'Heuristic Evaluation',text:'The heuristic "Visibility of System Status" means:',opts:['The design must be visually attractive',"The system should always inform users about what is going on — e.g., a loading spinner",'The navigation must always be visible on screen','All icons must have visible labels'],ans:1},
  {id:23,section:'medium',cat:'Heuristic Evaluation',text:'"Error prevention" as a usability heuristic means:',opts:['Designing the system to prevent errors from happening in the first place','Showing a clear error message after every mistake','Allowing users to undo all their actions','Limiting user inputs to pre-set options only'],ans:0},
  {id:24,section:'medium',cat:'Heuristic Evaluation',text:'Which heuristic is violated when an app uses "Submit" on one screen and "Send" for the same action on another?',opts:['Visibility of System Status','Consistency and Standards','Flexibility and Efficiency of Use','Recognition Rather Than Recall'],ans:1},
  {id:25,section:'medium',cat:'UX Research',text:'What is the key difference between qualitative and quantitative UX research?',opts:['Quantitative uses surveys; qualitative only uses interviews','Qualitative explores why and how users behave; quantitative measures what and how many','Qualitative research is always faster to conduct','Qualitative always uses larger sample sizes than quantitative'],ans:1},
  {id:26,section:'medium',cat:'UX Research',text:'According to Nielsen, how many participants are usually enough for one round of usability testing?',opts:['3–5','7–10','15–20','25–30'],ans:0},
  {id:27,section:'medium',cat:'UX Research',text:'What is the "think-aloud" method in usability testing?',opts:['Giving users a script to read during testing','Asking participants to speak their thoughts out loud while using a product','Recording eye movements to see where users look','An interview conducted after the testing session'],ans:1},
  {id:28,section:'medium',cat:'UX Research',text:'A/B testing in UX involves:',opts:['Testing a product with two different age groups simultaneously','Showing two different versions of a design to users to see which performs better','Testing a product in the morning and evening to compare results',"Comparing your product to a competitor's product"],ans:1},
  {id:29,section:'medium',cat:'UX Research',text:'What is a "user journey map"?',opts:['A geographic map showing where your users are located','A visual diagram of the steps, thoughts, and feelings a user experiences while completing a goal','A flowchart of all the screens in an app','A sitemap showing page hierarchy'],ans:1},
  {id:30,section:'medium',cat:'Information Architecture',text:'What does "card sorting" help determine in UX?',opts:['The visual layout and color scheme of UI components',"How users naturally group and label content — useful for designing navigation",'The order of animations on a screen','How many screens a product needs'],ans:1},
  {id:31,section:'medium',cat:'Information Architecture',text:'Which navigation pattern places menu items at the bottom of a mobile screen?',opts:['Hamburger menu','Tab bar / Bottom navigation','Mega menu','Breadcrumb trail'],ans:1},
  {id:32,section:'medium',cat:'Information Architecture',text:'What is a "sitemap" in UX design?',opts:["A visual diagram showing a website's page hierarchy and structure",'A geographic map embedded inside a mobile app','A full-page layout blueprint for each screen','A list of all hyperlinks on a page'],ans:0},
  {id:33,section:'medium',cat:'Information Architecture',text:'What does "breadcrumb navigation" help users understand?',opts:['How many steps are left in a checkout flow',"Where they are in a website's hierarchy and how to go back",'The history of their search queries','Which pages load the fastest'],ans:1},
  {id:34,section:'medium',cat:'Wireframing & Prototyping',text:'What is a "low-fidelity wireframe" primarily used for?',opts:['Final visual design approval before launch','Quickly exploring layout and structure ideas without worrying about visual details','Developer handoff documentation with specs','Specifying animation and transition details'],ans:1},
  {id:35,section:'medium',cat:'Wireframing & Prototyping',text:'What is the main difference between a mockup and a prototype?',opts:['A prototype is static; a mockup is interactive','A mockup is a static visual design; a prototype simulates real interactions','A mockup uses real content; a prototype uses placeholder text','There is no functional difference between them'],ans:1},
  {id:36,section:'medium',cat:'Wireframing & Prototyping',text:'Why is paper prototyping useful?',opts:['It produces the most realistic final design','It allows rapid, low-cost testing of basic ideas and user flows before any digital work','It generates developer specifications automatically','It is the preferred format for investor presentations'],ans:1},
  {id:37,section:'medium',cat:'Accessibility',text:'What does WCAG stand for?',opts:['Web Content Accessibility Guidelines','Web Color and Graphics Standard','Worldwide Component Accessibility Group','Web Compliance and Governance Charter'],ans:0},
  {id:38,section:'medium',cat:'Accessibility',text:'What does "alt text" on an image do for accessibility?',opts:['Makes the image load faster','Provides a text description of the image for screen reader users who cannot see it','Adds a visible caption below the image','Changes the image size for different screen sizes'],ans:1},
  {id:39,section:'medium',cat:'Accessibility',text:'Why is color alone not sufficient to convey information in a UI?',opts:['It makes the design look less professional','Users who are color blind or have low vision may not be able to distinguish the colors','It slows down page loading','It conflicts with dark mode settings'],ans:1},
  {id:40,section:'medium',cat:'Accessibility',text:'What does "keyboard accessibility" mean in web design?',opts:['The ability to type quickly using a keyboard','Ensuring a website can be fully navigated using only a keyboard without a mouse','Providing keyboard shortcuts for power users',"Making sure the keyboard doesn't cause typing errors"],ans:1},
  {id:41,section:'medium',cat:'Design Systems',text:'What is the primary benefit of a design system?',opts:['It eliminates the need for user research','It ensures visual and functional consistency across a product or product family','It automatically generates code from designs','It replaces the need for design tools like Figma'],ans:1},
  {id:42,section:'medium',cat:'Design Systems',text:'In atomic design, what is a "component" (or "molecule")?',opts:['The smallest possible UI element, like a single icon','A combination of basic elements (atoms) that form a simple, reusable UI piece — like a search bar','A complete page template with all content','A full design specification document'],ans:1},
  {id:43,section:'medium',cat:'Design Systems',text:'What is a "design token"?',opts:['A payment unit inside design software subscriptions','A named variable that stores a design decision, like a specific color value or spacing size','A reusable UI component in a design system library','A license key for a design tool'],ans:1},
  {id:44,section:'medium',cat:'Design Systems',text:'Which of these is a widely-used, open design system?',opts:['Sketch Libraries',"Google's Material Design",'Adobe XD Assets','Figma Auto Layout'],ans:1},
  {id:45,section:'medium',cat:'Mobile UX',text:'What is the recommended minimum touch target size for mobile buttons?',opts:['24×24 px','44×44 px','64×64 px','80×80 px'],ans:1},
  // SECTION C: ADVANCED (45-59)
  {id:46,section:'hard',cat:'UX Research Methods',text:'Why do UX researchers use multiple research methods (e.g., interviews + analytics) together?',opts:['To make the project look more thorough in reports','To validate findings from different angles and reduce the chance of drawing wrong conclusions','So different team members can each do one method','Multiple methods are only needed for very large teams'],ans:1},
  {id:47,section:'hard',cat:'UX Research Methods',text:'What is the main risk of relying only on self-reported data (e.g., surveys) in UX research?',opts:['Surveys always have low response rates','Users may not accurately report their actual behaviour — they describe what they think they do, not what they actually do','Surveys are too expensive for most projects','Self-reported data cannot be used for quantitative analysis'],ans:1},
  {id:48,section:'hard',cat:'UX Research Methods',text:'Contextual inquiry is best described as:',opts:['A type of survey conducted via email','Observing and interviewing users in their actual environment while they perform real tasks','A remote usability test using screen sharing software','A structured cognitive walkthrough done by the design team alone'],ans:1},
  {id:49,section:'hard',cat:'Advanced Interaction',text:'What is a "mental model" in UX design?',opts:["A diagram mapping a product's database structure",'A user\'s internal belief about how a system works, based on prior experience','A Figma component used to simulate user thinking','A heatmap showing where users look on a page'],ans:1},
  {id:50,section:'hard',cat:'Advanced Interaction',text:'The "Gulf of Execution" (Norman) refers to:',opts:['The gap between what users intend to do and the actions the system makes available','The time delay between a user action and a system response','The visual distance between navigation elements','The difference in skill levels between beginner and expert users'],ans:0},
  {id:51,section:'hard',cat:'Advanced Interaction',text:'Which technique is used to evaluate a design by having experts walk through user tasks step by step to find usability problems — without real users?',opts:['Heuristic evaluation','Cognitive walkthrough','Diary study','Participatory design'],ans:1},
  {id:52,section:'hard',cat:'Advanced Interaction',text:'In motion design, what is the primary purpose of "easing" (e.g., ease-in-out)?',opts:['To reduce file size of animations','To make animations feel more natural and physically believable by varying speed over time','To synchronise animations with sound','To limit animation to specific browser types'],ans:1},
  {id:53,section:'hard',cat:'Accessibility & Inclusion',text:'What does "inclusive design" mean beyond just meeting WCAG compliance?',opts:['Designing exclusively for users with disabilities','Designing for the full range of human diversity — including ability, language, culture, and context — so the product works better for everyone','Creating a separate version of a product for disabled users','Following a standard checklist of accessibility requirements'],ans:1},
  {id:54,section:'hard',cat:'Accessibility & Inclusion',text:'What is ARIA (in web accessibility) used for?',opts:['A design handoff format between Figma and developers','Adding semantic meaning to HTML elements to make them understandable by assistive technologies','An alternative to CSS for styling web pages','A framework for building accessible React components'],ans:1},
  {id:55,section:'hard',cat:'Strategy & Metrics',text:'What does "task success rate" measure in a usability study?',opts:['How quickly users complete a task','The percentage of users who complete a defined task correctly without assistance','How satisfied users feel after completing a task','The number of errors made during task completion'],ans:1},
  {id:56,section:'hard',cat:'Strategy & Metrics',text:'NPS (Net Promoter Score) measures:',opts:['How long users spend inside a product','How likely users are to recommend a product to others — used as a proxy for overall satisfaction and loyalty','The error rate in a product over a 30-day period','How many new users a product gains each month'],ans:1},
  {id:57,section:'hard',cat:'Strategy & Metrics',text:'What is "desirability testing" in UX?',opts:['Testing if users want to buy a product','Assessing the emotional and aesthetic response users have to a design — often using word-association cards','Measuring the visual appeal of colour palettes','A method for testing onboarding flow completion rates'],ans:1},
  {id:58,section:'hard',cat:'Advanced Design Systems',text:'What problem does a "single source of truth" design system solve?',opts:['It ensures developers can code faster','It prevents inconsistencies by ensuring all teams work from one shared, up-to-date set of design standards and components','It eliminates the need for design reviews','It auto-generates design files from code'],ans:1},
  {id:59,section:'hard',cat:'Advanced Design Systems',text:'What is "design debt" and why is it a problem?',opts:['Unpaid design tool subscriptions','The accumulation of inconsistencies, workarounds, and outdated patterns in a product that slow future design and development work','Having too many designers on a project','The cost of redesigning a product from scratch'],ans:1},
  {id:60,section:'hard',cat:'Advanced Design Systems',text:'In a large design system, what is a "governance model" responsible for?',opts:['Approving all UI designs before they go to development','Defining how the design system is maintained, updated, and how contributions are reviewed and approved across teams','Automatically checking designs against brand guidelines','Generating component documentation from Figma files'],ans:1},
  ];
}

app.get('/api/questions', (req, res) => {
  res.json(getAllQuestions());
});

// ──────────────────────────────
//  START
// ──────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🔴 Stranger Things Quiz running on http://localhost:${PORT}`);
  console.log(`   Quiz: http://localhost:${PORT}/quiz.html`);
  console.log(`   Admin: http://localhost:${PORT}/chmod777.html`);
});
