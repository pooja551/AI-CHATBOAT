import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import { SAMPLE_CLAIMS } from './src/data/sampleClaims';
import { POLICIES } from './src/data/policyData';
import { evaluateClaimDeterministic } from './src/agent/agentCore';
import { Claim, AgentResult } from './src/types/claim';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Initialize Google GenAI client if API key is configured
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    model: 'gemini-3.8-flash',
    timestamp: new Date().toISOString()
  });
});

// Policies knowledge base endpoint
app.get('/api/policies', (req: Request, res: Response) => {
  res.json(POLICIES);
});

// Sample claims endpoint - strictly Appendix B claims
app.get('/api/claims', (req: Request, res: Response) => {
  res.json({
    sampleClaims: SAMPLE_CLAIMS
  });
});

// System instruction prompt for Gemini model
const SYSTEM_INSTRUCTION = `
You are an autonomous Travel Reimbursement Approval Agent for corporate financial governance.
Your role is to rigorously evaluate employee travel expense reimbursement claims against the official corporate policy rules.

### Appendix A: Travel Reimbursement Policy (Stable Rules):
1. Eligible & Ineligible Categories:
- POL-CAT-01: Eligible categories (reimbursable for documented business purpose): Airfare (economy class only), Lodging (hotel room charges), Meals (subject to daily limits), Ground transport (taxi, rideshare, train, rental car, parking), Conference/registration fees.
- POL-CAT-02: Ineligible items (never reimbursable; deducted in full): Alcohol and minibar charges; Spa, gym, and personal entertainment; In-room movies, personal shopping, gifts; Traffic fines, penalties, and late fees; Any personal expense.

2. Per-Diem & Category Limits:
- POL-PD-01: Meals max $75.00/day. Amounts above daily cap are deducted; rest is reimbursed.
- POL-PD-02: Lodging max $200.00/night. Amounts above nightly cap are deducted; rest is reimbursed.
- POL-PD-03: Ground transport max $50.00/day. Amounts above cap are deducted.
- POL-AIR-01: Airfare class: Only economy class is reimbursable. Business/first-class fares are a policy exception and MUST be routed to MANUAL_REVIEW (not auto-deducted, because pre-approval may exist).

3. Receipt Rules:
- POL-RCT-01: Any single item > $25.00 requires an attached itemized receipt. Airfare and lodging ALWAYS require a receipt regardless of amount.
- POL-RCT-02: If a receipt is missing for an item requiring one, the item is NOT silently rejected — the claim is routed to MANUAL_REVIEW so reviewer can request the receipt.

4. Approval Thresholds (on total reimbursable amount):
- POL-APR-01: Total ≤ $500: auto-approved if fully compliant.
- POL-APR-02: Total > $500 and ≤ $2,000: Manager tier, treated as approvable when fully compliant.
- POL-APR-03: Total > $2,000: Director tier, exceeds agent auto-approval authority and MUST be routed to MANUAL_REVIEW.

5. Timeliness:
- POL-TIME-01: Submitted within 30 days of expense/trip date. Late claims routed to MANUAL_REVIEW.

Decision Rules:
- APPROVE: Every item eligible, receipts present, within per-diem caps, within tier (POL-APR-01/02).
- PARTIAL_APPROVE: Valid business items, but some amounts exceeded per-diem caps or contained non-reimbursable exclusions; excess deducted.
- REJECT: All claimed items are strictly ineligible under POL-CAT-02 with nothing reimbursable.
- MANUAL_REVIEW: Policy exceptions (business class airfare POL-AIR-01), missing required receipts (POL-RCT-02), total > $2,000 (POL-APR-03), late submission > 30 days (POL-TIME-01), or ambiguity.

Always output structured JSON adhering exactly to the required schema.
`;

// Evaluate single claim endpoint
app.post('/api/evaluate-claim', async (req: Request, res: Response) => {
  try {
    const claim: Claim = req.body.claim;
    const forceDeterministic: boolean = req.body.forceDeterministic === true;

    if (!claim || !claim.claim_id) {
      res.status(400).json({ error: 'Invalid claim object provided' });
      return;
    }

    // Always run the deterministic tool engine for baseline ground truth & audit trail
    const deterministicResult = evaluateClaimDeterministic(claim);

    // If Gemini is available and not forced deterministic, run Gemini 3.8 Flash
    if (ai && !forceDeterministic) {
      try {
        const geminiCall = ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: `Evaluate the following reimbursement claim:\n${JSON.stringify(claim, null, 2)}`,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                claim_id: { type: Type.STRING },
                decision: {
                  type: Type.STRING,
                  enum: ['APPROVE', 'PARTIAL_APPROVE', 'REJECT', 'MANUAL_REVIEW']
                },
                approved_amount: { type: Type.NUMBER },
                deducted_amount: { type: Type.NUMBER },
                missing_docs: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                policy_refs: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                confidence: { type: Type.NUMBER },
                explanation: { type: Type.STRING },
                tools_used: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: [
                'claim_id',
                'decision',
                'approved_amount',
                'deducted_amount',
                'missing_docs',
                'policy_refs',
                'confidence',
                'explanation',
                'tools_used'
              ]
            }
          }
        });

        // 6 second timeout race
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API timeout')), 6000)
        );

        const response: any = await Promise.race([geminiCall, timeout]);

        const textOutput = response.text;
        if (textOutput) {
          const geminiParsed = JSON.parse(textOutput);
          // Combine Gemini synthesis with structured audit steps from tool engine
          const combinedResult: AgentResult = {
            claim_id: claim.claim_id,
            decision: geminiParsed.decision,
            approved_amount: Number(geminiParsed.approved_amount),
            deducted_amount: Number(geminiParsed.deducted_amount),
            missing_docs: Array.isArray(geminiParsed.missing_docs) ? geminiParsed.missing_docs : [],
            policy_refs: Array.isArray(geminiParsed.policy_refs) ? geminiParsed.policy_refs : deterministicResult.policy_refs,
            confidence: Number(geminiParsed.confidence) || 0.95,
            explanation: geminiParsed.explanation,
            tools_used: Array.isArray(geminiParsed.tools_used) && geminiParsed.tools_used.length > 0
              ? geminiParsed.tools_used
              : deterministicResult.tools_used,
            audit_steps: deterministicResult.audit_steps,
            item_evaluations: deterministicResult.item_evaluations,
            evaluated_at: new Date().toISOString(),
            evaluator_engine: 'gemini-3.8-flash'
          };
          res.json(combinedResult);
          return;
        }
      } catch (geminiError) {
        console.warn('Gemini evaluation error, falling back to deterministic agent:', geminiError);
      }
    }

    // Default or fallback to deterministic tool agent
    res.json(deterministicResult);
  } catch (error: any) {
    console.error('Error evaluating claim:', error);
    res.status(500).json({ error: error.message || 'Internal evaluation error' });
  }
});

// Evaluate all claims endpoint
app.post('/api/evaluate-all-claims', async (req: Request, res: Response) => {
  try {
    const claims: Claim[] = req.body.claims || SAMPLE_CLAIMS;
    const forceDeterministic: boolean = req.body.forceDeterministic === true;

    const results: AgentResult[] = [];
    for (const claim of claims) {
      const resDeterministic = evaluateClaimDeterministic(claim);
      // For fast and reliable batch execution, use the audited tool engine
      results.push(resDeterministic);
    }

    res.json(results);
  } catch (error: any) {
    console.error('Error in batch evaluation:', error);
    res.status(500).json({ error: error.message || 'Internal batch error' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Travel Reimbursement Agent Server running on port ${PORT}`);
  });
}

startServer();
