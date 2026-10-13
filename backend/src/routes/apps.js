const express = require('express');
const AppAccess = require('../models/AppAccess');
const { CATEGORIES, classify } = require('../services/appCategories');
const { PACKAGE_RE } = require('../services/appAccess');
const { startAnalysis } = require('../services/decisionLayer');

const router = express.Router();

const MAX_APPS = 500;

// What the screen needs for one app (icons come from the phone itself).
function view(doc) {
  return {
    package: doc.package,
    label: doc.label,
    category: doc.userCategory || doc.category,
    categoryCorrected: Boolean(doc.userCategory),
    access: doc.access === true,
    accessUpdatedAt: doc.accessUpdatedAt,
    analysis: doc.analysis || { status: 'none', methods: [] },
  };
}

async function listAll() {
  const docs = await AppAccess.find().sort({ label: 1 }).lean();
  return docs.map(view);
}

router.get('/', async (req, res) => {
  try {
    res.json({ apps: await listAll(), categories: CATEGORIES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The phone reports what's installed: new apps are added (access No), known ones get their
// name refreshed. Access and the user's category corrections are never touched here.
router.post('/sync', async (req, res) => {
  try {
    const apps = (Array.isArray(req.body?.apps) ? req.body.apps : [])
      .filter((a) => a && typeof a.package === 'string' && PACKAGE_RE.test(a.package))
      .slice(0, MAX_APPS);
    const now = new Date();
    if (apps.length) {
      await AppAccess.bulkWrite(
        apps.map((a) => {
          const label = typeof a.label === 'string' ? a.label.slice(0, 120) : a.package;
          const androidCategory = Number.isInteger(a.androidCategory) ? a.androidCategory : -1;
          return {
            updateOne: {
              filter: { package: a.package },
              update: {
                $set: { label, androidCategory, category: classify({ package: a.package, label, androidCategory }), lastSeenAt: now },
                $setOnInsert: { package: a.package, access: false },
              },
              upsert: true,
            },
          };
        })
      );
    }
    res.json({ apps: await listAll(), categories: CATEGORIES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Yes/No access. Responds with the saved record, so the app only shows what was persisted.
// Turning access on starts the Decision Layer's method analysis.
router.put('/:package/access', async (req, res) => {
  try {
    const pkg = req.params.package;
    if (!PACKAGE_RE.test(pkg)) return res.status(400).json({ error: 'invalid package identifier' });
    if (typeof req.body?.access !== 'boolean') return res.status(400).json({ error: 'access must be true or false' });
    const label = typeof req.body.label === 'string' ? req.body.label.slice(0, 120) : undefined;
    const doc = await AppAccess.findOneAndUpdate(
      { package: pkg },
      {
        $set: { access: req.body.access, accessUpdatedAt: new Date() },
        $setOnInsert: { package: pkg, label: label || pkg, category: classify({ package: pkg, label }) },
      },
      { upsert: true, new: true, lean: true }
    );
    console.log(`[apps] ${pkg} access -> ${doc.access ? 'Yes' : 'No'}`);
    // Enabling an app starts the Decision Layer's method analysis (in the background).
    const shown = doc.access ? (await startAnalysis(pkg).catch(() => null)) || doc : doc;
    res.json({ app: view(shown) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The user's category correction (null = back to the automatic one). Never affects access.
router.put('/:package/category', async (req, res) => {
  try {
    const pkg = req.params.package;
    if (!PACKAGE_RE.test(pkg)) return res.status(400).json({ error: 'invalid package identifier' });
    const category = req.body?.category ?? null;
    if (category !== null && !CATEGORIES.includes(category)) return res.status(400).json({ error: 'unknown category' });
    const doc = await AppAccess.findOneAndUpdate({ package: pkg }, { $set: { userCategory: category } }, { new: true, lean: true });
    if (!doc) return res.status(404).json({ error: 'app not found' });
    res.json({ app: view(doc) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Re-runs the Decision Layer analysis for one app (Refresh / Retry). Responds at once with the
// record in "pending"; the screen refreshes until it's completed or failed.
router.post('/:package/analyze', async (req, res) => {
  try {
    const pkg = req.params.package;
    if (!PACKAGE_RE.test(pkg)) return res.status(400).json({ error: 'invalid package identifier' });
    const doc = await startAnalysis(pkg);
    if (!doc) return res.status(404).json({ error: 'app not found' });
    res.json({ app: view(doc) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
