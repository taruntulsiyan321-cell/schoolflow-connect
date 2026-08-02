/**
 * Generates idempotent SQL seed for RBSE Class 11–12 Commerce question bank.
 * Run: node scripts/generate-rbse-commerce-seed.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(
  __dirname,
  "../supabase/migrations/20260802220100_rbse_commerce_11_12_question_seed.sql",
);

const SOURCE = "seed_rbse_commerce_v1";

/** @typedef {{ q: string, o: [string,string,string,string], c: number, e: string, ch: string, concept?: string, diff?: string }} Q */

/** @type {Record<string, Record<number, Q[]>>} */
const BANK = {
  Accountancy: {
    11: [
      { ch: "Introduction to Accounting", concept: "meaning_objectives", q: "Accounting primarily provides information that is useful for:", o: ["Personal entertainment", "Decision-making by users", "Sports ranking", "Weather forecasts"], c: 1, e: "Accounting’s core purpose is to provide useful financial information for decision-making.", diff: "easy" },
      { ch: "Introduction to Accounting", concept: "users", q: "Which of the following is an internal user of accounting information?", o: ["Tax authority", "Management", "Investor in another firm", "Stock exchange"], c: 1, e: "Management uses accounting data inside the organisation for planning and control.", diff: "easy" },
      { ch: "Theory Base of Accounting", concept: "gaap", q: "The going concern assumption means the business is assumed to:", o: ["Close within a month", "Continue for the foreseeable future", "Never earn profit", "Avoid all liabilities"], c: 1, e: "Going concern assumes continuation of operations in the foreseeable future.", diff: "easy" },
      { ch: "Theory Base of Accounting", concept: "accrual", q: "Under the accrual basis, revenue is recognised when:", o: ["Cash is received only", "It is earned, whether or not cash is received", "Goods are ordered", "The owner withdraws cash"], c: 1, e: "Accrual recognises revenue when earned and expenses when incurred.", diff: "medium" },
      { ch: "Recording of Transactions-I", concept: "journal", q: "In a journal entry, the account to be debited is written:", o: ["After the credit account", "First, against the left", "Only in the ledger", "Never"], c: 1, e: "Conventionally the debit account is written first in the journal.", diff: "easy" },
      { ch: "Recording of Transactions-I", concept: "double_entry", q: "Every debit has a corresponding credit of equal amount. This is the essence of:", o: ["Single entry", "Double entry system", "Cash basis only", "Window dressing"], c: 1, e: "Double entry records equal debit and credit for each transaction.", diff: "easy" },
      { ch: "Recording of Transactions-II", concept: "cash_book", q: "A two-column cash book records:", o: ["Only bank transactions", "Cash and bank columns", "Only credit sales", "Only depreciation"], c: 1, e: "Two-column cash book typically has cash and bank columns.", diff: "easy" },
      { ch: "Recording of Transactions-II", concept: "purchase_book", q: "Credit purchases of goods are primarily recorded in the:", o: ["Sales book", "Purchases book", "Cash book", "Journal proper only"], c: 1, e: "Purchases book records credit purchases of goods.", diff: "easy" },
      { ch: "Bank Reconciliation Statement", concept: "brs_purpose", q: "A Bank Reconciliation Statement is prepared to reconcile:", o: ["Cash book balance with pass book balance", "Trial balance with balance sheet", "Sales with purchases", "Capital with drawings"], c: 0, e: "BRS explains differences between cash book and pass book balances.", diff: "easy" },
      { ch: "Bank Reconciliation Statement", concept: "timing", q: "Cheques issued but not yet presented for payment cause the pass book balance to be:", o: ["Lower than cash book (bank column)", "Higher than cash book (bank column)", "Always equal", "Irrelevant"], c: 1, e: "Unpresented cheques mean bank still shows a higher balance than the cash book.", diff: "medium" },
      { ch: "Trial Balance and Rectification of Errors", concept: "trial_balance", q: "A trial balance mainly helps to check:", o: ["Arithmetical accuracy of ledger postings", "Market price of shares", "Employee attendance", "Product quality"], c: 0, e: "Trial balance verifies that total debits equal total credits.", diff: "easy" },
      { ch: "Trial Balance and Rectification of Errors", concept: "error_omission", q: "If a transaction is completely omitted from the books, the trial balance:", o: ["Always fails to tally", "May still tally", "Shows double totals", "Cannot be prepared"], c: 1, e: "Complete omission does not disturb the equality of debits and credits.", diff: "medium" },
      { ch: "Depreciation, Provisions and Reserves", concept: "depreciation", q: "Depreciation is charged mainly because of:", o: ["Increase in cash", "Wear and tear / lapse of time of fixed assets", "Owner’s drawings", "Payment of wages"], c: 1, e: "Depreciation allocates the cost of a fixed asset over its useful life.", diff: "easy" },
      { ch: "Depreciation, Provisions and Reserves", concept: "straight_line", q: "Under the straight-line method, annual depreciation is:", o: ["Increasing each year", "Constant each year (given same cost/life/scrap)", "Always zero", "Based on market price only"], c: 1, e: "SLM charges equal depreciation each year when inputs are unchanged.", diff: "easy" },
      { ch: "Financial Statements – I", concept: "trading_account", q: "Gross profit is generally calculated in the:", o: ["Balance sheet only", "Trading account", "Cash flow statement", "Journal proper"], c: 1, e: "Trading account determines gross profit or gross loss.", diff: "easy" },
      { ch: "Financial Statements – I", concept: "closing_stock", q: "Closing stock appearing in the trial balance is shown in the:", o: ["Trading account only as a debit", "Balance sheet as an asset (and not again as credit in trading if already adjusted)", "Capital account only", "Purchases book"], c: 1, e: "Treatment depends on whether stock is adjusted; typically it is an asset on the balance sheet.", diff: "medium" },
      { ch: "Financial Statements – II", concept: "balance_sheet", q: "A balance sheet shows:", o: ["Only incomes for the year", "Assets and liabilities (financial position) on a date", "Only cash receipts", "Only owner’s hobbies"], c: 1, e: "Balance sheet presents financial position as on a particular date.", diff: "easy" },
      { ch: "Financial Statements – II", concept: "outstanding", q: "Outstanding expenses are shown as:", o: ["Asset", "Liability", "Income", "Drawings"], c: 1, e: "Expenses incurred but unpaid are current liabilities.", diff: "easy" },
      { ch: "Theory Base of Accounting", concept: "consistency", q: "The consistency principle requires that:", o: ["Accounting methods change every week", "Same accounting methods are followed from period to period unless justified", "Cash is never recorded", "Assets are never depreciated"], c: 1, e: "Consistency aids comparability across periods.", diff: "medium" },
      { ch: "Introduction to Accounting", concept: "bookkeeping_vs_accounting", q: "Book-keeping is best described as:", o: ["Interpretation of financial statements only", "Recording of financial transactions", "Auditing only", "Marketing research"], c: 1, e: "Book-keeping is the recording stage; accounting includes analysis and reporting.", diff: "easy" },
    ],
    12: [
      { ch: "Accounting for Partnership — Basic Concepts", concept: "partnership_deed", q: "In the absence of a partnership deed, profits are shared:", o: ["In capital ratio", "Equally", "In seniority order", "Only by the managing partner"], c: 1, e: "Indian Partnership Act: equal profit sharing if no deed provides otherwise.", diff: "easy" },
      { ch: "Accounting for Partnership — Basic Concepts", concept: "interest_capital", q: "If the deed is silent, interest on partners’ capital is:", o: ["Allowed at 12%", "Not allowed", "Allowed at bank rate only", "Compulsory every month"], c: 1, e: "No interest on capital unless the deed allows it.", diff: "easy" },
      { ch: "Accounting for Partnership — Basic Concepts", concept: "fixed_capital", q: "Under the fixed capital method, partners’ capital accounts normally:", o: ["Change with every profit share", "Remain fixed; adjustments go to current accounts", "Are never opened", "Show only drawings"], c: 1, e: "Fixed capital keeps capital constant; current accounts absorb adjustments.", diff: "medium" },
      { ch: "Reconstitution — Admission", concept: "goodwill", q: "When a new partner brings goodwill in cash and it is retained in the firm, it is credited to:", o: ["New partner only", "Sacrificing partners in sacrifice ratio", "All partners equally always", "Bank only"], c: 1, e: "Premium for goodwill compensates sacrificing partners.", diff: "medium" },
      { ch: "Reconstitution — Admission", concept: "sacrifice_ratio", q: "Sacrifice ratio is:", o: ["New share − old share", "Old share − new share", "Always equal", "Capital ratio only"], c: 1, e: "Sacrifice = old share minus new share.", diff: "easy" },
      { ch: "Reconstitution — Retirement/Death", concept: "gaining_ratio", q: "Gaining ratio is used mainly to:", o: ["Distribute goodwill among gaining partners", "Compute depreciation", "Prepare BRS", "Record cash sales"], c: 0, e: "Gaining partners compensate the retiring partner for goodwill.", diff: "medium" },
      { ch: "Reconstitution — Retirement/Death", concept: "revaluation", q: "On retirement, revaluation profit is credited to:", o: ["Only the retiring partner", "All partners in old ratio", "Only gaining partners", "Employees"], c: 1, e: "Revaluation results belong to partners in the old profit-sharing ratio.", diff: "medium" },
      { ch: "Dissolution of Partnership Firm", concept: "realisation", q: "On dissolution, assets are transferred to:", o: ["Capital accounts directly at book value always", "Realisation account", "Drawings account", "Trading account"], c: 1, e: "Realisation account records realisation of assets and payment of liabilities.", diff: "easy" },
      { ch: "Accounting for Share Capital", concept: "authorised", q: "Authorised capital is the:", o: ["Capital actually issued", "Maximum capital the company can issue as per MoA", "Only calls in arrears", "Reserves only"], c: 1, e: "Authorised (nominal) capital is the MoA ceiling.", diff: "easy" },
      { ch: "Accounting for Share Capital", concept: "calls_arrears", q: "Calls in arrears appear in the balance sheet as:", o: ["Addition to share capital", "Deduction from subscribed capital", "Fictitious asset", "Contingent liability only"], c: 1, e: "Calls in arrears reduce the amount shown as subscribed/called-up capital.", diff: "medium" },
      { ch: "Issue and Redemption of Debentures", concept: "debenture_nature", q: "Debentures generally represent:", o: ["Ownership capital", "Long-term borrowed funds", "Drawings", "Free reserves only"], c: 1, e: "Debentures are instruments of debt.", diff: "easy" },
      { ch: "Issue and Redemption of Debentures", concept: "interest", q: "Interest on debentures is:", o: ["Appropriation of profit", "A charge against profit", "Never recorded", "Always capitalised"], c: 1, e: "Debenture interest is a charge against profits.", diff: "easy" },
      { ch: "Financial Statements of a Company", concept: "schedule_iii", q: "Company financial statements in India are broadly presented as per:", o: ["Schedule III of the Companies Act", "Partnership Act only", "Income Tax slabs only", "Sports rules"], c: 0, e: "Schedule III prescribes the format of company financial statements.", diff: "easy" },
      { ch: "Analysis of Financial Statements", concept: "horizontal", q: "Comparative statements primarily facilitate:", o: ["Horizontal analysis over periods", "Recording journals", "Paying wages", "Bank reconciliation only"], c: 0, e: "Comparative statements compare figures across periods (horizontal analysis).", diff: "easy" },
      { ch: "Accounting Ratios", concept: "current_ratio", q: "Current ratio is:", o: ["Current assets ÷ Current liabilities", "Current liabilities ÷ Current assets", "Debt ÷ Equity", "NP ÷ Sales"], c: 0, e: "Current ratio = CA / CL.", diff: "easy" },
      { ch: "Accounting Ratios", concept: "debt_equity", q: "A high debt-equity ratio generally indicates:", o: ["Low financial leverage", "Higher financial leverage / risk", "No borrowings", "Only cash business"], c: 1, e: "Higher D/E means greater reliance on debt.", diff: "medium" },
      { ch: "Cash Flow Statement", concept: "as3_activities", q: "As per AS-3, cash flows are classified into:", o: ["Only investing", "Operating, investing and financing", "Trading and P&L only", "Personal and business only"], c: 1, e: "AS-3 uses operating, investing and financing activities.", diff: "easy" },
      { ch: "Cash Flow Statement", concept: "operating", q: "Cash received from customers is typically a cash flow from:", o: ["Financing activities", "Operating activities", "Investing activities", "Drawings"], c: 1, e: "Customer receipts are operating cash inflows.", diff: "easy" },
      { ch: "Accounting for Partnership — Basic Concepts", concept: "salary_partner", q: "Partner’s salary, if allowed by deed, is:", o: ["Debited to Profit and Loss Appropriation A/c", "Never recorded", "Always an asset", "Credited to goodwill only"], c: 0, e: "Partner’s salary is an appropriation of profit.", diff: "medium" },
      { ch: "Accounting Ratios", concept: "gp_ratio", q: "Gross profit ratio is:", o: ["Gross profit ÷ Net purchases", "Gross profit ÷ Net sales × 100", "Net profit ÷ Capital", "CA ÷ CL"], c: 1, e: "GP ratio = (GP / Net sales) × 100.", diff: "easy" },
    ],
  },
  "Business Studies": {
    11: [
      { ch: "Nature and Purpose of Business", concept: "economic_activity", q: "Business is primarily an:", o: ["Non-economic activity", "Economic activity with profit motive", "Hobby without risk", "Political campaign"], c: 1, e: "Business is an economic activity undertaken primarily for profit.", diff: "easy" },
      { ch: "Nature and Purpose of Business", concept: "industry", q: "Extractive industries are concerned with:", o: ["Manufacturing cars", "Extraction of products from natural sources", "Retail selling only", "Banking services"], c: 1, e: "Extractive industries draw products from nature (mining, fishing, etc.).", diff: "easy" },
      { ch: "Forms of Business Organisation", concept: "sole_prop", q: "In a sole proprietorship, liability of the owner is generally:", o: ["Limited to capital only always", "Unlimited", "Nil", "Shared equally with government"], c: 1, e: "Sole proprietor has unlimited liability.", diff: "easy" },
      { ch: "Forms of Business Organisation", concept: "partnership", q: "Minimum number of partners in a partnership (general) is:", o: ["One", "Two", "Seven", "Fifty"], c: 1, e: "Partnership requires at least two persons.", diff: "easy" },
      { ch: "Private, Public and Global Enterprises", concept: "pse", q: "A departmental undertaking is a form of:", o: ["Private company only", "Public sector enterprise", "NGO only", "Sole trade only"], c: 1, e: "Departmental undertakings are a form of public sector enterprise.", diff: "medium" },
      { ch: "Business Services", concept: "banking", q: "Which is a business service?", o: ["Manufacturing steel", "Banking", "Mining coal", "Growing wheat only"], c: 1, e: "Banking is a facilitative business service.", diff: "easy" },
      { ch: "Business Services", concept: "insurance", q: "The principle of utmost good faith in insurance is known as:", o: ["Subrogation", "Uberrimae fidei", "Indemnity only", "Contribution only"], c: 1, e: "Uberrimae fidei requires full disclosure of material facts.", diff: "medium" },
      { ch: "Emerging Modes of Business", concept: "ecommerce", q: "B2C e-commerce refers to transactions between:", o: ["Two governments", "Business and consumers", "Only wholesalers", "Employees only"], c: 1, e: "B2C is business-to-consumer commerce.", diff: "easy" },
      { ch: "Social Responsibilities of Business and Business Ethics", concept: "csr", q: "Social responsibility of business towards consumers includes:", o: ["Misleading advertising", "Supplying quality goods at fair prices", "Ignoring safety", "Hiding product defects"], c: 1, e: "Fair dealing and quality products are responsibilities to consumers.", diff: "easy" },
      { ch: "Formation of a Company", concept: "moa", q: "The document that defines the company’s relationship with outsiders is mainly the:", o: ["Articles of Association only", "Memorandum of Association", "Prospectus only", "Partnership deed"], c: 1, e: "MoA is the charter defining scope and external relations.", diff: "easy" },
      { ch: "Formation of a Company", concept: "aoa", q: "Articles of Association mainly contain:", o: ["Internal rules and regulations of the company", "Country’s constitution", "Only tax rates", "Employee personal diaries"], c: 0, e: "AoA governs internal management.", diff: "easy" },
      { ch: "Sources of Business Finance", concept: "equity_vs_debt", q: "Equity shareholders are:", o: ["Creditors of the company", "Owners of the company", "Employees only", "Customers only"], c: 1, e: "Equity represents ownership capital.", diff: "easy" },
      { ch: "Sources of Business Finance", concept: "retained", q: "Retained earnings are a source of:", o: ["External finance only", "Internal finance", "Government grant always", "Trade credit from suppliers only"], c: 1, e: "Retained earnings are plough-back of profits (internal).", diff: "easy" },
      { ch: "MSME and Business Entrepreneurship", concept: "entrepreneur", q: "An entrepreneur is a person who:", o: ["Only works as an employee forever", "Organises and takes risks to start and run a business", "Avoids all decisions", "Never innovates"], c: 1, e: "Entrepreneurs organise resources and bear risk.", diff: "easy" },
      { ch: "Internal Trade", concept: "wholesale", q: "Wholesalers generally sell goods to:", o: ["Final consumers in tiny quantities only", "Retailers in relatively large quantities", "Only exporters", "Only governments"], c: 1, e: "Wholesalers sell in bulk mainly to retailers.", diff: "easy" },
      { ch: "Internal Trade", concept: "retail", q: "Itinerant retailers include:", o: ["Departmental stores with fixed premises only", "Hawkers and peddlers", "Multiple chain stores only", "Super markets only"], c: 1, e: "Itinerant retailers have no fixed shop (hawkers, peddlers, etc.).", diff: "medium" },
      { ch: "International Business", concept: "export", q: "Export means:", o: ["Buying goods from abroad only", "Selling goods to other countries", "Only domestic trade", "Barter within a village"], c: 1, e: "Exports are sales of goods/services to foreign countries.", diff: "easy" },
      { ch: "International Business", concept: "import_doc", q: "A bill of lading is commonly associated with:", o: ["Domestic cash sales only", "Shipment of goods in international trade", "Payroll", "Depreciation"], c: 1, e: "Bill of lading is a shipping document in foreign trade.", diff: "medium" },
      { ch: "Nature and Purpose of Business", concept: "risk", q: "Business risk means the possibility of:", o: ["Only certain profit", "Inadequate profits or losses due to uncertainties", "Zero uncertainty", "Guaranteed government income"], c: 1, e: "Risk is uncertainty of returns/losses in business.", diff: "easy" },
      { ch: "Forms of Business Organisation", concept: "company", q: "A public company (under Companies Act context taught in class) generally has:", o: ["Unlimited membership always without rules", "Separate legal entity from its members", "No need for incorporation", "Only one owner by definition"], c: 1, e: "A company is a separate legal entity.", diff: "medium" },
    ],
    12: [
      { ch: "Nature and Significance of Management", concept: "definition", q: "Management is best described as:", o: ["Only doing clerical work", "Process of getting things done through others to achieve goals", "Avoiding planning", "Ignoring resources"], c: 1, e: "Management coordinates people and resources toward objectives.", diff: "easy" },
      { ch: "Nature and Significance of Management", concept: "levels", q: "Top-level management is primarily concerned with:", o: ["Only supervising shop-floor workers", "Overall goals, policies and strategic decisions", "Only packing goods", "Only attendance"], c: 1, e: "Top management sets direction and major policies.", diff: "easy" },
      { ch: "Principles of Management", concept: "fayol", q: "Henri Fayol’s principle of ‘unity of command’ means:", o: ["An employee should receive orders from one superior only", "Many bosses give conflicting orders", "No supervisor exists", "Only customers give orders"], c: 0, e: "Unity of command: one employee → one superior.", diff: "easy" },
      { ch: "Principles of Management", concept: "taylor", q: "Scientific management is closely associated with:", o: ["F.W. Taylor", "Adam Smith only as a manager", "Only Fayol’s 14 principles as science of motion study", "Kotler"], c: 0, e: "F.W. Taylor pioneered scientific management.", diff: "easy" },
      { ch: "Business Environment", concept: "dimensions", q: "Inflation and interest rates are part of the:", o: ["Political environment only", "Economic environment", "Demographic environment only", "Legal environment only"], c: 1, e: "Macroeconomic variables form the economic environment.", diff: "easy" },
      { ch: "Planning", concept: "nature", q: "Planning is:", o: ["Looking backward only", "Deciding in advance what to do and how to do it", "Only controlling after failure", "Ignoring goals"], c: 1, e: "Planning is anticipatory decision-making.", diff: "easy" },
      { ch: "Organising", concept: "delegation", q: "Delegation means:", o: ["Transfer of authority to subordinates with corresponding responsibility", "Avoiding all work", "Centralising every decision at the top only", "Firing employees"], c: 0, e: "Delegation entrusts authority and creates accountability.", diff: "easy" },
      { ch: "Staffing", concept: "process", q: "Which step comes first in the staffing process?", o: ["Performance appraisal", "Estimating manpower requirements / workforce planning", "Promotion only", "Orientation only"], c: 1, e: "Staffing begins with assessing human resource needs.", diff: "medium" },
      { ch: "Directing", concept: "motivation", q: "Motivation in directing refers to:", o: ["Forcing employees without incentives", "Stimulating people to act to achieve desired goals", "Only written rules", "Ignoring morale"], c: 1, e: "Motivation energises employees toward organisational goals.", diff: "easy" },
      { ch: "Controlling", concept: "process", q: "The first step in the controlling process is:", o: ["Taking corrective action", "Setting performance standards", "Comparing randomly", "Punishing staff"], c: 1, e: "Control starts with establishing standards.", diff: "easy" },
      { ch: "Financial Management", concept: "objective", q: "The primary objective of financial management is often stated as:", o: ["Maximising employee picnics", "Wealth maximisation of owners / maximising firm value", "Minimising all sales", "Avoiding investment"], c: 1, e: "Financial management aims at maximising owners’ wealth/firm value.", diff: "medium" },
      { ch: "Financial Management", concept: "working_capital", q: "Working capital refers to:", o: ["Only fixed assets", "Capital required for day-to-day operations", "Only share capital", "Only debentures"], c: 1, e: "Working capital finances short-term operating needs.", diff: "easy" },
      { ch: "Marketing Management", concept: "4ps", q: "Which is one of the 4Ps of marketing mix?", o: ["Profit tax", "Product", "Partnership Act", "Payroll"], c: 1, e: "Product, Price, Place, Promotion are the classic 4Ps.", diff: "easy" },
      { ch: "Marketing Management", concept: "promotion", q: "Advertising is a tool of:", o: ["Production only", "Promotion", "Controlling only", "Staffing only"], c: 1, e: "Advertising is a promotional tool.", diff: "easy" },
      { ch: "Consumer Protection", concept: "rights", q: "Right to be informed is a consumer right that relates to:", o: ["Hiding product information", "Getting complete information about goods/services", "Paying unfair prices always", "Ignoring expiry dates"], c: 1, e: "Consumers should receive adequate product information.", diff: "easy" },
      { ch: "Consumer Protection", concept: "redressal", q: "Under the Consumer Protection Act framework taught in class, a consumer can approach:", o: ["Only foreign courts always", "Consumer dispute redressal agencies / commissions", "Only partnership firms", "Only advertisers"], c: 1, e: "Consumer forums/commissions provide redressal.", diff: "medium" },
      { ch: "Business Environment", concept: "liberalisation", q: "Liberalisation in the Indian context generally means:", o: ["Increasing government restrictions on business", "Reducing unnecessary controls and opening the economy", "Banning all imports", "Ending private enterprise"], c: 1, e: "Liberalisation eases controls and opens markets.", diff: "medium" },
      { ch: "Organising", concept: "span", q: "Span of management refers to:", o: ["Number of subordinates a manager can effectively supervise", "Width of the office desk", "Only factory size", "Number of products only"], c: 0, e: "Span of control/management is the number of direct reports.", diff: "easy" },
      { ch: "Principles of Management", concept: "esprit", q: "Esprit de corps emphasises:", o: ["Conflict among teams", "Team spirit and harmony", "Isolation of workers", "Ignoring groups"], c: 1, e: "Esprit de corps builds unity and team spirit.", diff: "easy" },
      { ch: "Financial Management", concept: "capital_structure", q: "Capital structure refers to the mix of:", o: ["Only current assets", "Debt and equity used to finance the firm", "Only inventory", "Only cash"], c: 1, e: "Capital structure is the debt–equity mix.", diff: "easy" },
    ],
  },
  Economics: {
    11: [
      { ch: "Introduction", concept: "statistics_meaning", q: "Statistics in economics is useful mainly because it:", o: ["Replaces all theory", "Helps in understanding and analysing economic data", "Is only for sports", "Avoids measurement"], c: 1, e: "Statistics supports economic analysis with quantitative data.", diff: "easy" },
      { ch: "Collection of Data", concept: "primary", q: "Primary data are:", o: ["Collected by someone else earlier always", "Collected by the investigator for the first time for the purpose", "Always outdated", "Never used in research"], c: 1, e: "Primary data are original data collected for the current purpose.", diff: "easy" },
      { ch: "Organisation of Data", concept: "classification", q: "Classification of data means:", o: ["Destroying data", "Arranging data into groups/classes based on similarity", "Only drawing cartoons", "Ignoring variables"], c: 1, e: "Classification organises raw data into meaningful classes.", diff: "easy" },
      { ch: "Presentation of Data", concept: "bar_diagram", q: "A bar diagram is suitable for presenting:", o: ["Only continuous frequency curves always", "Discrete categorical comparisons", "Only maps", "Only balance sheets"], c: 1, e: "Bar diagrams compare discrete categories effectively.", diff: "easy" },
      { ch: "Measures of Central Tendency", concept: "arithmetic_mean", q: "The arithmetic mean of 2, 4, 6, 8 is:", o: ["4", "5", "6", "8"], c: 1, e: "Mean = (2+4+6+8)/4 = 5.", diff: "easy" },
      { ch: "Measures of Central Tendency", concept: "median", q: "For the ordered set 3, 5, 7, 9, 11 the median is:", o: ["3", "7", "11", "5"], c: 1, e: "Middle value of five observations is 7.", diff: "easy" },
      { ch: "Correlation", concept: "direction", q: "If two variables move in the same direction, correlation is:", o: ["Negative", "Positive", "Always zero", "Undefined always"], c: 1, e: "Same-direction movement indicates positive correlation.", diff: "easy" },
      { ch: "Index Numbers", concept: "purpose", q: "Index numbers are used to measure:", o: ["Only individual heights", "Relative changes in variables over time", "Only one day’s weather", "Partner’s capital"], c: 1, e: "Index numbers track relative change versus a base.", diff: "easy" },
      { ch: "Indian Economy on the Eve of Independence", concept: "colonial", q: "On the eve of independence, the Indian economy was largely:", o: ["Highly industrialised like Britain", "Stagnant and agrarian under colonial impact", "A digital economy", "Free of poverty"], c: 1, e: "Colonial policies left a largely agrarian, stagnant economy.", diff: "medium" },
      { ch: "Indian Economy 1950–1990", concept: "planning", q: "India adopted a strategy of:", o: ["No planning at all", "Economic planning with Five-Year Plans", "Only free banking without state", "Ending agriculture"], c: 1, e: "India used Five-Year Plans for planned development.", diff: "easy" },
      { ch: "LPG — An Appraisal", concept: "1991", q: "The 1991 reforms in India are associated with:", o: ["Only increasing licence raj", "Liberalisation, privatisation and globalisation", "Ending all trade", "Banning FDI always"], c: 1, e: "LPG reforms opened and liberalised the economy.", diff: "easy" },
      { ch: "Human Capital Formation", concept: "education", q: "Investment in education is considered investment in:", o: ["Physical capital only", "Human capital", "Only land", "Only machines"], c: 1, e: "Education builds human capital.", diff: "easy" },
      { ch: "Rural Development", concept: "credit", q: "Formal sources of rural credit include:", o: ["Only moneylenders", "Cooperatives and commercial banks", "Only friends", "Only landlords"], c: 1, e: "Institutional/formal credit includes banks and cooperatives.", diff: "easy" },
      { ch: "Employment", concept: "types", q: "Disguised unemployment is common in:", o: ["Only IT firms with surplus staff always", "Agriculture where more people work than needed", "Only space research", "Only stock exchanges"], c: 1, e: "Disguised unemployment: marginal productivity near zero in overcrowded farms.", diff: "medium" },
      { ch: "Environment and Sustainable Development", concept: "sustainable", q: "Sustainable development aims to meet present needs:", o: ["By exhausting all resources now", "Without compromising future generations’ ability to meet theirs", "By ignoring environment", "By maximising pollution"], c: 1, e: "Classic Brundtland idea of sustainability.", diff: "easy" },
      { ch: "Comparative Development Experiences", concept: "china_india", q: "Compared with India, China’s growth strategy after 1978 emphasised:", o: ["Closing to the world", "Market-oriented reforms and opening up", "Ending manufacturing", "Only subsistence farming forever"], c: 1, e: "China’s reforms opened the economy and accelerated growth.", diff: "medium" },
      { ch: "Measures of Central Tendency", concept: "mode", q: "Mode is the value that:", o: ["Is always the average", "Occurs most frequently", "Is always the middle", "Is never observed"], c: 1, e: "Mode = most frequent observation.", diff: "easy" },
      { ch: "Collection of Data", concept: "census_vs_sample", q: "A sample survey studies:", o: ["The entire population always", "A representative part of the population", "Only one person forever", "No units at all"], c: 1, e: "Sampling studies a subset to infer about the population.", diff: "easy" },
      { ch: "Index Numbers", concept: "base_year", q: "In index numbers, the base year is the year:", o: ["With index usually taken as 100", "That is ignored", "After all future years", "Without data"], c: 0, e: "Base-year index is conventionally 100.", diff: "easy" },
      { ch: "Use of Statistical Tools", concept: "project", q: "Statistical tools in a project help students to:", o: ["Avoid data completely", "Collect, organise, present and interpret data systematically", "Only copy answers", "Ignore conclusions"], c: 1, e: "Project work applies the statistical toolkit end-to-end.", diff: "easy" },
    ],
    12: [
      { ch: "Introduction", concept: "micro_vs_macro", q: "Microeconomics studies:", o: ["The economy as a whole only", "Individual units like consumers and firms", "Only government budgets", "Only foreign exchange"], c: 1, e: "Micro focuses on individual economic agents.", diff: "easy" },
      { ch: "Theory of Consumer Behaviour", concept: "utility", q: "Marginal utility is the:", o: ["Total satisfaction from all units", "Additional utility from consuming one more unit", "Price of the good only", "Income of the consumer"], c: 1, e: "MU = change in TU from an extra unit.", diff: "easy" },
      { ch: "Theory of Consumer Behaviour", concept: "demand", q: "Other things equal, when price of a normal good falls, quantity demanded:", o: ["Falls", "Rises", "Becomes zero", "Is unaffected always"], c: 1, e: "Law of demand: inverse price–quantity relation.", diff: "easy" },
      { ch: "Production and Costs", concept: "short_run", q: "In the short run, at least one factor is:", o: ["Always variable", "Fixed", "Priceless", "International only"], c: 1, e: "Short run: some input(s) fixed.", diff: "easy" },
      { ch: "The Theory of the Firm under Perfect Competition", concept: "price_taker", q: "Under perfect competition, a firm is a:", o: ["Price maker with monopoly power", "Price taker", "Only a government unit", "Cartel leader always"], c: 1, e: "Competitive firms take the market price as given.", diff: "easy" },
      { ch: "Market Equilibrium", concept: "excess_demand", q: "If market price is below equilibrium, there tends to be:", o: ["Excess supply", "Excess demand", "No trade", "Infinite supply only"], c: 1, e: "Below-equilibrium price creates shortage (excess demand).", diff: "medium" },
      { ch: "Non-competitive Markets", concept: "monopoly", q: "A monopoly market has:", o: ["Many sellers of identical goods", "A single seller of a product with no close substitutes", "Perfect information and free entry always", "Zero barriers"], c: 1, e: "Monopoly: single seller, barriers, no close substitutes.", diff: "easy" },
      { ch: "Introduction", concept: "macro_focus", q: "Macroeconomics is concerned with:", o: ["Only one consumer’s choice", "Aggregates like national income, employment, inflation", "Only a single firm’s cost curve", "Only one market’s demand curve"], c: 1, e: "Macro studies economy-wide aggregates.", diff: "easy" },
      { ch: "National Income Accounting", concept: "gdp", q: "GDP at market price measures:", o: ["Only household savings", "Market value of final goods and services produced within domestic territory in a period", "Only intermediate goods", "Only imports"], c: 1, e: "GDP is domestic production of final goods/services.", diff: "easy" },
      { ch: "National Income Accounting", concept: "methods", q: "Which is a method of measuring national income?", o: ["Colour method", "Value added / product method", "Attendance method", "Depreciation-only method"], c: 1, e: "Product (value added), income and expenditure methods are standard.", diff: "easy" },
      { ch: "Money and Banking", concept: "functions_money", q: "Which is a primary function of money?", o: ["Medium of exchange", "Printing newspapers", "Building roads directly", "Teaching in schools"], c: 0, e: "Medium of exchange is a primary function of money.", diff: "easy" },
      { ch: "Money and Banking", concept: "crr", q: "CRR refers to the share of deposits that banks must keep with:", o: ["The RBI as cash reserves", "Foreign banks only", "Shareholders only", "Customers’ homes"], c: 0, e: "Cash Reserve Ratio is maintained with the central bank.", diff: "medium" },
      { ch: "Determination of Income and Employment", concept: "multiplier", q: "The investment multiplier is larger when MPC is:", o: ["Lower", "Higher", "Zero always", "Negative"], c: 1, e: "Multiplier = 1/(1−MPC); rises with MPC.", diff: "medium" },
      { ch: "Government Budget and the Economy", concept: "deficit", q: "A fiscal deficit arises when:", o: ["Government receipts exceed expenditure excluding borrowings in a defined sense", "Government’s total expenditure exceeds its total receipts excluding borrowings", "Exports exceed imports only", "Banks hold excess reserves only"], c: 1, e: "Fiscal deficit reflects borrowing need of the government.", diff: "medium" },
      { ch: "Open Economy Macroeconomics", concept: "exchange_rate", q: "An increase in demand for foreign currency, other things equal, tends to:", o: ["Appreciate the domestic currency", "Depreciate the domestic currency", "Have no effect ever", "Eliminate trade"], c: 1, e: "Higher forex demand raises its price → domestic currency depreciates.", diff: "medium" },
      { ch: "Production and Costs", concept: "mc", q: "Marginal cost is the:", o: ["Total cost divided by output", "Addition to total cost from producing one more unit", "Fixed cost only", "Price of the product"], c: 1, e: "MC = ΔTC/ΔQ.", diff: "easy" },
      { ch: "Theory of Consumer Behaviour", concept: "budget", q: "A budget line shows combinations of two goods that:", o: ["Give equal utility always", "Exhaust the consumer’s income at given prices", "Are impossible to buy", "Ignore prices"], c: 1, e: "Budget line: affordable bundles that spend all income.", diff: "easy" },
      { ch: "National Income Accounting", concept: "intermediate", q: "Intermediate goods are excluded from GDP to avoid:", o: ["Double counting", "Taxation", "Exports", "Employment"], c: 0, e: "Counting intermediates and finals would double-count value.", diff: "easy" },
      { ch: "Determination of Income and Employment", concept: "ad", q: "Aggregate demand in a simple closed economy without government typically includes:", o: ["Only exports", "Consumption and investment", "Only taxes", "Only imports"], c: 1, e: "AD = C + I in the simplest closed model.", diff: "easy" },
      { ch: "Government Budget and the Economy", concept: "revenue_receipt", q: "Tax receipts of the government are generally:", o: ["Capital receipts", "Revenue receipts", "Always borrowings", "Always disinvestment"], c: 1, e: "Taxes are revenue receipts (no liability created).", diff: "easy" },
    ],
  },
  Mathematics: {
    11: [
      { ch: "Sets", concept: "union", q: "If A = {1,2,3} and B = {3,4}, then A ∪ B is:", o: ["{3}", "{1,2,3,4}", "{1,2}", "{}"], c: 1, e: "Union contains all elements from A or B.", diff: "easy" },
      { ch: "Sets", concept: "subset", q: "Which is true?", o: ["{1} ⊂ {1,2}", "{1,2} ⊂ {1}", "{} ⊄ {}", "{2} ⊂ {1}"], c: 0, e: "{1} is a subset of {1,2}.", diff: "easy" },
      { ch: "Relations and Functions", concept: "domain", q: "For f: {1,2,3} → ℝ given by f(x)=x², the domain is:", o: ["{1,4,9}", "{1,2,3}", "ℝ", "{0}"], c: 1, e: "Domain is the set of inputs {1,2,3}.", diff: "easy" },
      { ch: "Trigonometric Functions", concept: "sin_values", q: "sin(π/2) equals:", o: ["0", "1", "−1", "1/2"], c: 1, e: "sin(π/2) = 1.", diff: "easy" },
      { ch: "Complex Numbers and Quadratic Equations", concept: "i_squared", q: "i² equals:", o: ["1", "−1", "i", "0"], c: 1, e: "By definition i² = −1.", diff: "easy" },
      { ch: "Linear Inequalities", concept: "solution", q: "The solution of x − 3 < 2 is:", o: ["x < 5", "x > 5", "x = 5", "x < 1"], c: 0, e: "x − 3 < 2 ⇒ x < 5.", diff: "easy" },
      { ch: "Permutations and Combinations", concept: "nCr", q: "C(5,2) equals:", o: ["10", "20", "5", "25"], c: 0, e: "C(5,2)=5!/(2!3!)=10.", diff: "easy" },
      { ch: "Binomial Theorem", concept: "expansion", q: "The number of terms in the expansion of (a+b)ⁿ is:", o: ["n", "n+1", "2n", "n−1"], c: 1, e: "(a+b)ⁿ has n+1 terms.", diff: "easy" },
      { ch: "Sequences and Series", concept: "ap", q: "The 5th term of AP 2,5,8,… is:", o: ["11", "14", "17", "8"], c: 1, e: "a=2,d=3; a5=2+4×3=14.", diff: "easy" },
      { ch: "Straight Lines", concept: "slope", q: "Slope of the line through (1,2) and (3,6) is:", o: ["2", "1", "4", "1/2"], c: 0, e: "m=(6−2)/(3−1)=2.", diff: "easy" },
      { ch: "Conic Sections", concept: "circle", q: "Equation x² + y² = 25 represents a circle of radius:", o: ["5", "25", "10", "√25/2"], c: 0, e: "x²+y²=r² with r=5.", diff: "easy" },
      { ch: "Introduction to Three Dimensional Geometry", concept: "distance", q: "Distance from (0,0,0) to (1,2,2) is:", o: ["3", "√5", "5", "1"], c: 0, e: "√(1+4+4)=√9=3.", diff: "easy" },
      { ch: "Limits and Derivatives", concept: "limit", q: "limₓ→₀ (sin x)/x equals:", o: ["0", "1", "∞", "−1"], c: 1, e: "Standard limit lim (sin x)/x = 1 as x→0.", diff: "medium" },
      { ch: "Limits and Derivatives", concept: "derivative", q: "Derivative of x³ with respect to x is:", o: ["3x²", "x²", "3x", "x³"], c: 0, e: "d/dx(xⁿ)=n xⁿ⁻¹.", diff: "easy" },
      { ch: "Statistics", concept: "mean", q: "Mean of 10, 20, 30 is:", o: ["20", "30", "15", "60"], c: 0, e: "(10+20+30)/3=20.", diff: "easy" },
      { ch: "Probability", concept: "classical", q: "Probability of getting a head in a fair coin toss is:", o: ["0", "1", "1/2", "2"], c: 2, e: "Two equally likely outcomes; P(H)=1/2.", diff: "easy" },
      { ch: "Relations and Functions", concept: "function_def", q: "A relation f from A to B is a function if:", o: ["Every element of A has a unique image in B", "Some elements of A have two images", "A is empty always", "B has no elements"], c: 0, e: "Each domain element maps to exactly one image.", diff: "medium" },
      { ch: "Trigonometric Functions", concept: "identity", q: "sin²θ + cos²θ equals:", o: ["0", "1", "2", "tan θ"], c: 1, e: "Fundamental identity.", diff: "easy" },
      { ch: "Complex Numbers and Quadratic Equations", concept: "modulus", q: "Modulus of 3+4i is:", o: ["5", "7", "12", "1"], c: 0, e: "|a+bi|=√(a²+b²)=5.", diff: "easy" },
      { ch: "Permutations and Combinations", concept: "nPr", q: "P(5,2) equals:", o: ["20", "10", "5", "25"], c: 0, e: "P(5,2)=5×4=20.", diff: "easy" },
    ],
    12: [
      { ch: "Relations and Functions", concept: "onto", q: "A function f: A→B is onto if:", o: ["Range equals B", "Range is a proper subset of B always", "A has one element only", "f is constant always"], c: 0, e: "Onto (surjective): every b in B is an image.", diff: "medium" },
      { ch: "Inverse Trigonometric Functions", concept: "range_arcsin", q: "The principal value range of sin⁻¹x is:", o: ["[0,π]", "[−π/2, π/2]", "(0,π)", "ℝ"], c: 1, e: "Principal values of arcsin lie in [−π/2, π/2].", diff: "medium" },
      { ch: "Matrices", concept: "order", q: "A matrix with 2 rows and 3 columns has order:", o: ["3×2", "2×3", "6×1", "1×6"], c: 1, e: "Order is rows × columns.", diff: "easy" },
      { ch: "Matrices", concept: "identity", q: "In the identity matrix I, diagonal elements are:", o: ["0", "1", "2", "−1"], c: 1, e: "I has 1s on the diagonal and 0 elsewhere.", diff: "easy" },
      { ch: "Determinants", concept: "det2", q: "det|[[1,2],[3,4]]| equals:", o: ["−2", "2", "10", "−10"], c: 0, e: "1·4 − 2·3 = −2.", diff: "easy" },
      { ch: "Continuity and Differentiability", concept: "continuity", q: "If limₓ→a f(x) = f(a), then f is:", o: ["Discontinuous at a", "Continuous at a", "Not defined at a", "Always differentiable everywhere"], c: 1, e: "Continuity requires limit equals function value.", diff: "easy" },
      { ch: "Application of Derivatives", concept: "increasing", q: "If f′(x) > 0 on an interval, f is:", o: ["Decreasing", "Increasing", "Constant", "Undefined"], c: 1, e: "Positive derivative ⇒ increasing function.", diff: "easy" },
      { ch: "Integrals", concept: "basic", q: "∫ 2x dx equals:", o: ["x² + C", "2x² + C", "x + C", "2 + C"], c: 0, e: "∫2x dx = x² + C.", diff: "easy" },
      { ch: "Application of Integrals", concept: "area", q: "Area under y=f(x) from x=a to x=b (f≥0) is:", o: ["∫_a^b f(x) dx", "f′(b)−f′(a)", "f(a)+f(b)", "ab"], c: 0, e: "Definite integral gives signed area.", diff: "easy" },
      { ch: "Differential Equations", concept: "order", q: "Order of dy/dx + y = 0 is:", o: ["0", "1", "2", "3"], c: 1, e: "Highest derivative is first order.", diff: "easy" },
      { ch: "Vector Algebra", concept: "dot", q: "If a·b = 0 and a,b ≠ 0, then a and b are:", o: ["Parallel", "Perpendicular", "Equal", "Opposite always"], c: 1, e: "Zero dot product ⇒ orthogonal vectors.", diff: "easy" },
      { ch: "Three Dimensional Geometry", concept: "direction_cosines", q: "If l,m,n are direction cosines, then:", o: ["l+m+n=1", "l²+m²+n²=1", "lmn=1", "l=m=n=0"], c: 1, e: "Identity: l²+m²+n²=1.", diff: "medium" },
      { ch: "Linear Programming", concept: "feasible", q: "The feasible region of an LPP is the set of points that:", o: ["Violate all constraints", "Satisfy all constraints", "Ignore the objective", "Are always integers only"], c: 1, e: "Feasible region = constraint-satisfying points.", diff: "easy" },
      { ch: "Probability", concept: "bayes_setup", q: "P(A|B) denotes:", o: ["P(A)/P(B) always", "Conditional probability of A given B", "P(A∪B)", "P(A∩B) only without division"], c: 1, e: "P(A|B)=P(A∩B)/P(B).", diff: "easy" },
      { ch: "Matrices", concept: "transpose", q: "If A is of order 2×3, then Aᵀ is of order:", o: ["2×3", "3×2", "2×2", "3×3"], c: 1, e: "Transpose swaps rows and columns.", diff: "easy" },
      { ch: "Determinants", concept: "property", q: "If two rows of a determinant are identical, its value is:", o: ["1", "0", "−1", "2"], c: 1, e: "Identical rows ⇒ determinant zero.", diff: "easy" },
      { ch: "Integrals", concept: "definite", q: "∫_0^1 1 dx equals:", o: ["0", "1", "2", "1/2"], c: 1, e: "[x]_0^1 = 1.", diff: "easy" },
      { ch: "Application of Derivatives", concept: "maxima", q: "At a local maximum of a differentiable function, f′(x) is typically:", o: ["Positive", "Zero (stationary point)", "Undefined always", "Equal to f(x)"], c: 1, e: "Interior local extrema occur at critical points where f′=0 (if differentiable).", diff: "medium" },
      { ch: "Vector Algebra", concept: "magnitude", q: "Magnitude of vector î + ĵ + k̂ is:", o: ["1", "√3", "3", "√2"], c: 1, e: "√(1+1+1)=√3.", diff: "easy" },
      { ch: "Relations and Functions", concept: "inverse", q: "A function has an inverse if it is:", o: ["Only constant", "Bijective", "Only many-one", "Not one-one"], c: 1, e: "Invertible functions are bijective.", diff: "medium" },
    ],
  },
  English: {
    11: [
      { ch: "The Portrait of a Lady", concept: "theme", q: "In ‘The Portrait of a Lady’, the grandmother is portrayed mainly as:", o: ["A careless neighbour", "A deeply religious and caring presence in the narrator’s life", "A business tycoon", "A silent stranger with no routine"], c: 1, e: "Khushwant Singh sketches a devout, affectionate grandmother.", diff: "easy" },
      { ch: "We’re Not Afraid to Die…", concept: "theme", q: "The narrative ‘We’re Not Afraid to Die…’ primarily highlights:", o: ["A shopping trip", "Courage and teamwork in a sea crisis", "A classroom debate", "A sports final"], c: 1, e: "The family faces a storm with courage and cooperation.", diff: "easy" },
      { ch: "Discovering Tut", concept: "idea", q: "‘Discovering Tut’ is largely about:", o: ["A cricket match", "Investigation into Tutankhamun’s tomb and death", "Modern banking", "A Hindi poem"], c: 1, e: "The piece explores forensic/archaeological inquiry into Tut.", diff: "easy" },
      { ch: "The Ailing Planet", concept: "theme", q: "‘The Ailing Planet’ mainly discusses:", o: ["Fashion trends", "Environmental degradation and sustainable development", "Algebra proofs", "Cookery"], c: 1, e: "Nani Palkhivala argues for caring for Earth’s resources.", diff: "easy" },
      { ch: "The Adventure", concept: "concept", q: "Gangadharpant’s ‘adventure’ involves:", o: ["A parallel-history thought experiment about India", "Opening a cafe", "Learning swimming only", "A music concert"], c: 0, e: "Jayant Narlikar’s story explores alternate history.", diff: "medium" },
      { ch: "Silk Road", concept: "setting", q: "‘Silk Road’ recounts a journey mainly through:", o: ["Antarctica", "The high-altitude route toward Mount Kailash region", "Amazon rainforest", "Australian outback"], c: 1, e: "Nick Middleton travels the Silk Road toward Kailash.", diff: "easy" },
      { ch: "The Summer of the Beautiful White Horse", concept: "theme", q: "The boys in Saroyan’s story borrow the horse mainly out of:", o: ["Hatred for the owner", "Longing and innocence rather than malice", "A business plan", "A school assignment"], c: 1, e: "Their act is mischievous yet rooted in longing, not cruelty.", diff: "medium" },
      { ch: "The Address", concept: "theme", q: "‘The Address’ deals with:", o: ["War’s aftermath and loss through a returned visit for mother’s things", "A wedding menu", "Stock trading", "A science fair"], c: 0, e: "Marga Minco’s story explores memory and loss after war.", diff: "easy" },
      { ch: "Grammar — Tenses", concept: "present_perfect", q: "Choose the correct sentence:", o: ["She have finished the report.", "She has finished the report.", "She finishing the report.", "She finish the report yesterday."], c: 1, e: "Third person singular takes has + past participle.", diff: "easy" },
      { ch: "Grammar — Subject-Verb Agreement", concept: "agreement", q: "Neither of the proposals ___ acceptable.", o: ["are", "is", "were being", "have"], c: 1, e: "‘Neither’ takes a singular verb.", diff: "medium" },
      { ch: "Business English", concept: "formal_email", q: "A suitable formal closing for a business email is:", o: ["See ya", "Yours faithfully / Regards", "Whatever", "Lol bye"], c: 1, e: "Formal correspondence uses conventional closings.", diff: "easy" },
      { ch: "Business English", concept: "concision", q: "Which sentence is most appropriate in a professional email?", o: ["Kindly find attached the invoice for April.", "Yo check the bill dude.", "Invoice stuff somehow.", "I dunno about payment."], c: 0, e: "Clear, polite, specific language suits business English.", diff: "easy" },
      { ch: "Comprehension Skills", concept: "inference", q: "Inference in reading means:", o: ["Copying the first line only", "Drawing a logical conclusion from given information", "Ignoring the text", "Counting adjectives only"], c: 1, e: "Inference goes beyond explicit statements using evidence.", diff: "easy" },
      { ch: "Mother’s Day", concept: "theme", q: "In ‘Mother’s Day’, the play satirises:", o: ["Space travel", "Family members taking the mother for granted", "Bank audits", "Farming tools"], c: 1, e: "Priestley critiques undervaluing of mothers’ labour.", diff: "easy" },
      { ch: "Birth", concept: "focus", q: "A.J. Cronin’s ‘Birth’ centres on:", o: ["A medical emergency and a doctor’s determination", "A picnic", "A political speech", "A dance exam"], c: 0, e: "Andrew Manson struggles to save a newborn.", diff: "easy" },
      { ch: "The Tale of Melon City", concept: "irony", q: "The poem’s ending is ironic because:", o: ["The wisest man is always right", "A melon is crowned king after absurd ‘justice’", "The city bans fruit", "Nobody laughs"], c: 1, e: "Vikram Seth’s satire ends with a melon as king.", diff: "medium" },
      { ch: "Grammar — Articles", concept: "articles", q: "Choose the correct option: ___ honest trader keeps clear accounts.", o: ["A", "An", "The only always", "No article possible"], c: 1, e: "‘Honest’ begins with a vowel sound → an.", diff: "easy" },
      { ch: "Grammar — Prepositions", concept: "prepositions", q: "She apologised ___ the delay.", o: ["on", "for", "at", "over only"], c: 1, e: "Apologise for something.", diff: "easy" },
      { ch: "Vocabulary", concept: "synonym", q: "A close synonym of ‘meticulous’ is:", o: ["Careless", "Thorough", "Lazy", "Vague"], c: 1, e: "Meticulous means careful and precise.", diff: "easy" },
      { ch: "Business English", concept: "report", q: "In a short business report, the most useful opening is:", o: ["A clear purpose statement", "Random jokes only", "Personal gossip", "Unrelated poetry"], c: 0, e: "Reports begin by stating purpose/scope.", diff: "easy" },
    ],
    12: [
      { ch: "The Last Lesson", concept: "theme", q: "‘The Last Lesson’ mainly conveys:", o: ["The value of one’s language and the pain of losing it", "How to cook", "Stock market tips", "Cricket rules"], c: 0, e: "Alphonse Daudet stresses linguistic identity under occupation.", diff: "easy" },
      { ch: "Lost Spring", concept: "theme", q: "Anees Jung’s ‘Lost Spring’ focuses on:", o: ["Child labour and stolen childhoods", "Space research", "Corporate mergers", "Olympic training only"], c: 0, e: "The essay portrays poverty and child labour.", diff: "easy" },
      { ch: "Deep Water", concept: "theme", q: "In ‘Deep Water’, Douglas overcomes:", o: ["Fear of water through gradual practice", "Fear of heights only by ignoring it", "Fear of exams by cheating", "Fear of darkness by sleeping"], c: 0, e: "William Douglas conquers aquaphobia systematically.", diff: "easy" },
      { ch: "The Rattrap", concept: "theme", q: "The metaphor of the world as a rattrap suggests:", o: ["Material temptations that trap people", "A cooking recipe", "A maths theorem", "A sports stadium"], c: 0, e: "Lagerlöf’s peddler sees worldly bait as a rattrap.", diff: "medium" },
      { ch: "Indigo", concept: "focus", q: "‘Indigo’ highlights Gandhi’s work with:", o: ["Indigo sharecroppers in Champaran", "Only factory owners in Mumbai", "Only teachers in Delhi", "Only sailors"], c: 0, e: "Louis Fischer recounts the Champaran movement.", diff: "easy" },
      { ch: "My Mother at Sixty-Six", concept: "device", q: "The poem compares the mother’s face to:", o: ["A late winter’s moon", "A roaring fire", "A busy market", "A cricket pitch"], c: 0, e: "Kamala Das uses the pale winter moon image.", diff: "easy" },
      { ch: "Keeping Quiet", concept: "theme", q: "Neruda’s ‘Keeping Quiet’ advocates:", o: ["Introspection and stillness for peace", "Louder arguments", "Faster production only", "Ignoring nature"], c: 0, e: "The poem urges a pause for reflection and peace.", diff: "easy" },
      { ch: "A Thing of Beauty", concept: "idea", q: "According to Keats, a thing of beauty:", o: ["Is a joy forever", "Lasts only a day", "Causes only sorrow", "Is useless"], c: 0, e: "Opening line: ‘A thing of beauty is a joy for ever’.", diff: "easy" },
      { ch: "The Third Level", concept: "theme", q: "‘The Third Level’ explores:", o: ["Escape into a nostalgic past amid modern stress", "A chemistry lab", "A football final", "A tax audit"], c: 0, e: "Jack Finney blends time, memory and anxiety.", diff: "medium" },
      { ch: "The Tiger King", concept: "irony", q: "The Tiger King’s death is ironic because:", o: ["A wooden tiger causes the fatal injury after he killed many tigers", "He never hunted", "He drowned in a river only", "He became a doctor"], c: 0, e: "Fate fulfils the prophecy through a toy tiger.", diff: "medium" },
      { ch: "Grammar — Reported Speech", concept: "reporting", q: "Direct: She said, “I am ready.” Indirect:", o: ["She said that she was ready.", "She said that she is ready yesterday.", "She said she ready.", "She says she am ready."], c: 0, e: "Backshift present → past in reported speech.", diff: "easy" },
      { ch: "Grammar — Modals", concept: "modals", q: "To express strong obligation, the best modal is:", o: ["might", "must", "could (weak possibility only)", "may (permission only always)"], c: 1, e: "Must expresses strong necessity/obligation.", diff: "easy" },
      { ch: "Business English", concept: "minutes", q: "Minutes of a meeting should mainly record:", o: ["Decisions and action points clearly", "Only jokes told", "Every cough in the room", "Unrelated news"], c: 0, e: "Minutes capture decisions, responsibilities, deadlines.", diff: "easy" },
      { ch: "Business English", concept: "memo", q: "A memo is typically used for:", o: ["Informal internal workplace communication", "International treaties only", "Poetry contests", "Wedding invitations only"], c: 0, e: "Memos are brief internal notes.", diff: "easy" },
      { ch: "On the Face of It", concept: "theme", q: "Susan Hill’s play deals with:", o: ["Disability, loneliness and human connection", "Only stock prices", "Only cricket scores", "Only recipes"], c: 0, e: "Derry and Mr Lamb explore acceptance and isolation.", diff: "easy" },
      { ch: "The Enemy", concept: "dilemma", q: "Dr Sadao’s central conflict is between:", o: ["Professional duty/humanity and patriotic hostility", "Choosing two desserts", "Buying a car", "Writing an essay"], c: 0, e: "He treats an enemy soldier despite wartime pressure.", diff: "medium" },
      { ch: "Vocabulary", concept: "formal", q: "A formal synonym of ‘ask for’ in business writing is:", o: ["request", "yell", "nag", "beg casually"], c: 0, e: "‘Request’ is the formal choice.", diff: "easy" },
      { ch: "Comprehension Skills", concept: "tone", q: "Tone of a passage refers to:", o: ["The author’s attitude toward the subject", "Only font size", "Only page number", "Only word count"], c: 0, e: "Tone is the writer’s attitude.", diff: "easy" },
      { ch: "Going Places", concept: "theme", q: "Sophie’s daydreams in ‘Going Places’ mainly show:", o: ["Adolescent fantasy versus reality", "Advanced calculus", "Bank reconciliation", "Military strategy"], c: 0, e: "A.R. Barton contrasts dreams with harsh reality.", diff: "medium" },
      { ch: "Aunt Jennifer’s Tigers", concept: "symbol", q: "Aunt Jennifer’s tigers symbolise:", o: ["Freedom and fearlessness she lacks in life", "Her embroidery fees only", "A zoo visit", "A maths quiz"], c: 0, e: "The tigers contrast with her oppressed married life.", diff: "medium" },
    ],
  },
  Hindi: {
    11: [
      { ch: "नमक का दारोगा", concept: "पाठ_बोध", q: "‘नमक का दारोगा’ कहानी का लेखक है:", o: ["प्रेमचंद", "यशपाल", "जैनेन्द्र", "अज्ञेय"], c: 0, e: "यह प्रेमचंद की प्रसिद्ध कहानी है।", diff: "easy" },
      { ch: "नमक का दारोगा", concept: "चरित्र", q: "वज़ीर अली मुख्य रूप से चित्रित है:", o: ["ईमानदार अधिकारी के रूप में", "व्यापारी के रूप में", "कवि के रूप में", "सैनिक के रूप में"], c: 0, e: "वज़ीर अली कर्तव्यनिष्ठ दारोगा है।", diff: "easy" },
      { ch: "मियाँ नसीरुद्दीन", concept: "पाठ_बोध", q: "मियाँ नसीरुद्दीन की छवि मुख्यतः है:", o: ["सरल और व्यवहारकुशल व्यक्ति की", "क्रूर शासक की", "वैज्ञानिक की", "खिलाड़ी की"], c: 0, e: "पाठ में उनकी सादगी और सूझ-बूझ उभरती है।", diff: "easy" },
      { ch: "व्याकरण — संधि", concept: "स्वर_संधि", q: "‘सूर्योदय’ में संधि है:", o: ["सूर्य + उदय", "सूर + योदय", "सु + र्योदय", "सूर्यु + दय"], c: 0, e: "सूर्य + उदय = सूर्योदय (गुण स्वर संधि)।", diff: "easy" },
      { ch: "व्याकरण — समास", concept: "समास", q: "‘माता-पिता’ में समास है:", o: ["द्वंद्व", "तत्पुरुष", "कर्मधारय", "बहुव्रीहि"], c: 0, e: "दो पदों का योजक संबंध द्वंद्व समास दर्शाता है।", diff: "medium" },
      { ch: "व्याकरण — उपसर्ग", concept: "उपसर्ग", q: "‘अत्याचार’ में उपसर्ग है:", o: ["अति", "आचार", "अ", "त्य"], c: 0, e: "अति + आचार = अत्याचार।", diff: "easy" },
      { ch: "कबीर के पद", concept: "काव्य", q: "कबीर की भाषा मुख्यतः है:", o: ["सधुक्कड़ी / जनभाषा मिश्रित", "केवल संस्कृत", "केवल अंग्रेज़ी", "केवल फ़ारसी"], c: 0, e: "कबीर जनभाषा और सधुक्कड़ी में लिखते हैं।", diff: "easy" },
      { ch: "मीरा के पद", concept: "भक्ति", q: "मीराबाई की भक्ति मुख्य रूप से किसके प्रति है:", o: ["कृष्ण", "राम केवल राजनीतिक अर्थ में", "केवल प्रकृति", "केवल राजा"], c: 0, e: "मीरा कृष्ण-भक्ति के लिए प्रसिद्ध हैं।", diff: "easy" },
      { ch: "भारत माता", concept: "भाव", q: "‘भारत माता’ कविता में माँ की छवि जुड़ी है:", o: ["राष्ट्र और संस्कृति से", "केवल व्यापार से", "केवल खेल से", "केवल मशीन से"], c: 0, e: "राष्ट्रीय चेतना और मातृभूमि का भाव प्रमुख है।", diff: "easy" },
      { ch: "व्याकरण — विलोम", concept: "विलोम", q: "‘आस्तिक’ का विलोम है:", o: ["नास्तिक", "सत्य", "भक्त", "ज्ञानी"], c: 0, e: "आस्तिक ↔ नास्तिक।", diff: "easy" },
      { ch: "व्याकरण — पर्यायवाची", concept: "पर्याय", q: "‘अग्नि’ का पर्यायवाची नहीं है:", o: ["जल", "पावक", "बह्नि", "हुताशन"], c: 0, e: "जल अग्नि का पर्याय नहीं है।", diff: "easy" },
      { ch: "व्याकरण — वाक्य", concept: "शुद्ध_वाक्य", q: "शुद्ध वाक्य चुनिए:", o: ["वह विद्यालय जाता है।", "वह विद्यालय जाना है।", "वह विद्यालय जाते हैं मैं।", "वह विद्यालय जा रहा हूँ वह।"], c: 0, e: "लिंग-वचन और क्रिया का सही प्रयोग पहले विकल्प में है।", diff: "easy" },
      { ch: "जामुन का पेड़", concept: "व्यंग्य", q: "‘जामुन का पेड़’ पाठ की प्रमुख विशेषता है:", o: ["व्यंग्यात्मक शैली", "केवल विज्ञान प्रयोग", "केवल खाता-बही", "केवल खेल विवरण"], c: 0, e: "यह व्यंग्य प्रधान रचना है।", diff: "medium" },
      { ch: "राजस्थान की रजत बूँदें", concept: "विषय", q: "यह पाठ मुख्यतः संबंधित है:", o: ["जल संरक्षण / रेगिस्तानी जीवन के जल स्रोतों से", "समुद्री जहाज़ों से", "हवाई अड्डों से", "केवल फैशन से"], c: 0, e: "अनुपम मिश्र की रचना जल और मरुस्थलीय व्यवस्था पर है।", diff: "medium" },
      { ch: "व्याकरण — प्रत्यय", concept: "प्रत्यय", q: "‘लड़कपन’ में प्रत्यय है:", o: ["पन", "लड़", "क", "ई"], c: 0, e: "लड़का + पन = लड़कपन।", diff: "easy" },
      { ch: "व्याकरण — मुहावरा", concept: "मुहावरा", q: "‘आँखों का तारा’ मुहावरे का अर्थ है:", o: ["बहुत प्रिय व्यक्ति", "नेत्र रोग", "अँधेरा", "गुस्सा"], c: 0, e: "आँखों का तारा = अत्यंत प्रिय।", diff: "easy" },
      { ch: "आलो आँधारि", concept: "लेखिका", q: "‘आलो आँधारि’ किस विधा से जुड़ी है:", o: ["आत्मकथात्मक गद्य", "केवल नाटक सूत्र", "केवल पत्रकारिता रिपोर्ट", "केवल विज्ञापन"], c: 0, e: "यह बेबी हाल्दार की आत्मकथात्मक रचना है।", diff: "medium" },
      { ch: "व्याकरण — काल", concept: "काल", q: "‘वह पढ़ रहा था’ काल है:", o: ["अपूर्ण भूत", "सामान्य वर्तमान", "भविष्यत्", "संदिग्ध वर्तमान"], c: 0, e: "रहा था = अपूर्ण भूतकाल।", diff: "easy" },
      { ch: "घर की याद", concept: "भाव", q: "‘घर की याद’ कविता में प्रमुख भाव है:", o: ["विस्थापन / घर की स्मृति", "केवल व्यापार वृद्धि", "केवल परीक्षा भय", "केवल खेल उत्सव"], c: 0, e: "कविता में घर और स्मृति का भाव केंद्र में है।", diff: "easy" },
      { ch: "व्याकरण — वर्तनी", concept: "वर्तनी", q: "शुद्ध वर्तनी चुनिए:", o: ["अध्यक्ष", "अध्धक्ष", "अध्य्क्ष", "अधयक्ष"], c: 0, e: "मानक रूप ‘अध्यक्ष’ है।", diff: "easy" },
    ],
    12: [
      { ch: "सिल्वर वैडिंग", concept: "पाठ_बोध", q: "‘सिल्वर वैडिंग’ कहानी का प्रमुख विषय है:", o: ["पीढ़ीगत अंतर और सामाजिक परिवर्तन", "केवल युद्ध नीति", "केवल कृषि यंत्र", "केवल क्रिकेट"], c: 0, e: "मन्नू भंडारी की कहानी परिवार और बदलते मूल्यों पर है।", diff: "easy" },
      { ch: "जूझ", concept: "पाठ_बोध", q: "‘जूझ’ में संघर्ष मुख्यतः है:", o: ["शिक्षा और पारिवारिक दबाव के बीच", "केवल व्यापार घाटे का", "केवल खेल पुरस्कार का", "केवल यात्रा टिकट का"], c: 0, e: "आनंद यादव की आत्मकथांश में पढ़ाई का संघर्ष है।", diff: "easy" },
      { ch: "अतीत में दबे पाँव", concept: "विषय", q: "यह रचना मुख्यतः संबंधित है:", o: ["हड़प्पा सभ्यता की यात्रा-स्मृति से", "आधुनिक शेयर बाज़ार से", "केवल फ़ैशन शो से", "केवल रसोई व्यंजन से"], c: 0, e: "ओम थानवी की यात्रा-रचना पुरातात्त्विक स्थलों पर केंद्रित है।", diff: "medium" },
      { ch: "व्याकरण — समास", concept: "तत्पुरुष", q: "‘राजमार्ग’ में समास है:", o: ["तत्पुरुष", "द्वंद्व", "अव्ययीभाव", "द्विगु"], c: 0, e: "राजा का मार्ग = राजमार्ग (तत्पुरुष)।", diff: "easy" },
      { ch: "व्याकरण — संधि", concept: "व्यंजन", q: "‘सज्जन’ की संधि विच्छेद है:", o: ["सत् + जन", "सज् + जन", "स + ज्जन", "सत + ज्जन"], c: 0, e: "सत् + जन = सज्जन।", diff: "medium" },
      { ch: "व्याकरण — रस", concept: "रस", q: "करुण रस का स्थायी भाव है:", o: ["शोक", "हास", "क्रोध", "उत्साह"], c: 0, e: "करुण रस का स्थायी भाव शोक है।", diff: "easy" },
      { ch: "व्याकरण — अलंकार", concept: "उपमा", q: "‘मुख चंद्रमा के समान है’ में अलंकार है:", o: ["उपमा", "अतिशयोक्ति केवल बिना उपमान", "अनुप्रास केवल", "यमक केवल"], c: 0, e: "समानता के लिए ‘के समान’ → उपमा।", diff: "easy" },
      { ch: "काव्य — पद", concept: "छंद_भाव", q: "भक्तिकाव्य की सामान्य विशेषता है:", o: ["ईश्वर-प्रेम और सहज भाषा", "केवल वैज्ञानिक सूत्र", "केवल लेखा जोखा", "केवल खेल नियम"], c: 0, e: "भक्ति काव्य भक्ति और जनभाषा से जुड़ा है।", diff: "easy" },
      { ch: "व्याकरण — वाच्य", concept: "वाच्य", q: "‘राम द्वारा पत्र लिखा गया’ वाच्य है:", o: ["कर्मवाच्य", "कर्तृवाच्य", "भाववाच्य", "कोई नहीं"], c: 0, e: "‘द्वारा’ और ‘गया’ कर्मवाच्य के संकेत हैं।", diff: "medium" },
      { ch: "व्याकरण — विलोम", concept: "विलोम", q: "‘आकाश’ का विलोम है:", o: ["पाताल", "सूर्य", "वायु", "अग्नि"], c: 0, e: "आकाश ↔ पाताल प्रचलित युग्म है।", diff: "easy" },
      { ch: "व्याकरण — मुहावरा", concept: "मुहावरा", q: "‘नाक में दम करना’ का अर्थ है:", o: ["बहुत तंग करना", "सुगंधित होना", "सो जाना", "गायन करना"], c: 0, e: "मुहावरा अर्थ: अत्यधिक परेशान करना।", diff: "easy" },
      { ch: "गद्यांश बोध", concept: "शीर्षक", q: "गद्यांश का उपयुक्त शीर्षक चुनते समय सबसे महत्वपूर्ण है:", o: ["मुख्य भाव/विषय की पकड़", "केवल शब्द गिनती", "केवल लेखक का नाम अंदाज़", "केवल अंतिम पंक्ति नकल"], c: 0, e: "शीर्षक केंद्रीय भाव को संक्षेप में दर्शाए।", diff: "easy" },
      { ch: "व्याकरण — वर्तनी", concept: "वर्तनी", q: "शुद्ध शब्द है:", o: ["पुनरावृत्ति", "पुनराव्रत्ति", "पुनर्राव्रति", "पूनरावृत्ति"], c: 0, e: "मानक वर्तनी ‘पुनरावृत्ति’ है।", diff: "easy" },
      { ch: "व्याकरण — पर्यायवाची", concept: "पर्याय", q: "‘पृथ्वी’ का पर्यायवाची है:", o: ["धरा", "अग्नि", "वायुमात्र", "जलधि केवल समुद्र अर्थ में गलत"], c: 0, e: "धरा पृथ्वी का पर्याय है।", diff: "easy" },
      { ch: "डायरी के पन्ने", concept: "विधा", q: "डायरी लेखन की शैली होती है:", o: ["व्यक्तिगत अनुभव आधारित", "केवल सरकारी अधिसूचना", "केवल गणित सूत्र", "केवल विज्ञापन नारा"], c: 0, e: "डायरी निजी अनुभव और तिथिबद्ध लेखन है।", diff: "easy" },
      { ch: "व्याकरण — काल", concept: "भविष्य", q: "‘वह कल आएगा’ काल है:", o: ["सामान्य भविष्यत्", "पूर्ण भूत", "संदिग्ध वर्तमान", "हेतुहेतुमद् भूत"], c: 0, e: "आएगा = सामान्य भविष्यत्।", diff: "easy" },
      { ch: "काव्य सौंदर्य", concept: "बिम्ब", q: "काव्य में बिम्ब का अर्थ है:", o: ["चित्रवत अनुभूति / मानसिक चित्र", "केवल व्याकरण नियम", "केवल खाता", "केवल संख्या"], c: 0, e: "बिम्ब काव्य की चित्रात्मक अनुभूति है।", diff: "medium" },
      { ch: "व्याकरण — अव्यय", concept: "अव्यय", q: "निम्न में अव्यय है:", o: ["और", "लड़का", "किताबें", "लिखता"], c: 0, e: "‘और’ अव्यय (समुच्चयबोधक) है।", diff: "easy" },
      { ch: "पत्र लेखन", concept: "औपचारिक", q: "औपचारिक पत्र में उचित संबोधन है:", o: ["माननीय महोदय / महोदया", "यार", "ओय", "बस यूँ ही"], c: 0, e: "औपचारिक पत्र में शिष्ट संबोधन आवश्यक है।", diff: "easy" },
      { ch: "व्याकरण — वाक्य शुद्धि", concept: "शुद्धि", q: "शुद्ध वाक्य है:", o: ["अध्यापक जी कक्षा में आए।", "अध्यापक जी कक्षा में आये हैं मैं।", "अध्यापक जी कक्षा में आना।", "अध्यापक जी कक्षा में आते मैं हूँ।"], c: 0, e: "पहला विकल्प व्याकरणिक दृष्टि से शुद्ध है।", diff: "easy" },
    ],
  },
};

function esc(s) {
  return String(s).replace(/'/g, "''");
}

function optsJson(o) {
  return JSON.stringify(o).replace(/'/g, "''");
}

function emitRow(subject, classLevel, item, idx) {
  const diff = item.diff || "medium";
  const concept = item.concept || null;
  const topic = concept;
  return `  (
    ${classLevel},
    '${esc(subject)}',
    '${esc(item.ch)}',
    ${topic ? `'${esc(topic)}'` : "NULL"},
    '${diff}',
    '${esc(item.q)}',
    '${optsJson(item.o)}'::jsonb,
    ${item.c},
    '${esc(item.e)}',
    '${SOURCE}',
    true,
    'rbse',
    'ncert_aligned',
    ${concept ? `'${esc(concept)}'` : "NULL"},
    NULL,
    'commerce',
    'mcq'
  )`;
}

const counts = {};
let total = 0;
const valueBlocks = [];

for (const [subject, byClass] of Object.entries(BANK)) {
  for (const [cls, items] of Object.entries(byClass)) {
    const key = `${subject}|${cls}`;
    counts[key] = items.length;
    total += items.length;
    if (items.length < 15) {
      console.error(`WARN: ${key} has only ${items.length} questions`);
    }
    items.forEach((item, idx) => {
      valueBlocks.push(emitRow(subject, Number(cls), item, idx));
    });
  }
}

const sql = `-- ============================================================================
-- RBSE Class 11–12 COMMERCE question bank seed (APPROVED v1)
-- Subjects: English, Hindi, Accountancy, Mathematics, Business Studies, Economics
-- board=rbse, source_type=ncert_aligned, stream=commerce, school_id=NULL (platform)
-- Idempotent via source='${SOURCE}'
-- Generated counts: ${total} MCQs
-- ============================================================================

DO $seed$
DECLARE
  _existing int;
BEGIN
  SELECT count(*) INTO _existing
  FROM public.question_bank
  WHERE source = '${SOURCE}';

  IF _existing >= ${total} THEN
    RAISE NOTICE 'RBSE commerce seed already present (% rows); skipping', _existing;
    RETURN;
  END IF;

  -- Partial prior run: remove incomplete batch then re-insert cleanly
  IF _existing > 0 THEN
    DELETE FROM public.question_bank WHERE source = '${SOURCE}';
  END IF;

  INSERT INTO public.question_bank (
    class_level, subject, chapter, topic, difficulty, question, options, correct_index,
    explanation, source, is_approved,
    board, source_type, concept, school_id, stream, question_format
  ) VALUES
${valueBlocks.join(",\n")};

  RAISE NOTICE 'Inserted RBSE commerce seed: % MCQs', ${total};
END
$seed$;

-- Ensure Wisdom Campus board tag (safe if schema migration already ran)
UPDATE public.schools
SET board = coalesce(board, 'rbse')
WHERE id = '00000000-0000-4000-8000-000000000001'
   OR lower(coalesce(slug, '')) = 'wisdom-campus'
   OR lower(coalesce(name, '')) LIKE '%wisdom campus%';
`;

fs.writeFileSync(OUT, sql, "utf8");
console.log("Wrote", OUT);
console.log("Total:", total);
console.log("Counts:");
for (const [k, v] of Object.entries(counts).sort()) {
  console.log(`  ${k}: ${v}`);
}
