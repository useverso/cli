import type { BoardItem, State, Transition, Review } from './core/types.js';
import * as ui from './ui.js';

/** Pad a pre-colored string to `width` using the plain text length for measurement. */
function colorPad(colored: string, plain: string, width: number): string {
  return colored + ' '.repeat(Math.max(0, width - plain.length));
}

export type OutputFormat = 'human' | 'plain' | 'json';

function printPlainItem(item: BoardItem): void {
  console.log(`id: ${item.id}`);
  console.log(`state: ${item.state}`);
  console.log(`type: ${item.type}`);
  console.log(`title: ${item.title}`);
  console.log(`assignee: ${item.assignee}`);
  console.log(`autonomy: ${item.autonomy}`);
  if (item.description) console.log(`description: ${item.description}`);
  if (item.milestone) console.log(`milestone: ${item.milestone}`);
  if (item.spec_path) console.log(`spec_path: ${item.spec_path}`);
  if (item.complexity) console.log(`complexity: ${item.complexity}`);
  if (item.blocked_reason) console.log(`blocked_reason: ${item.blocked_reason}`);
  if (item.blocked_by.length > 0) console.log(`blocked_by: ${item.blocked_by.join(',')}`);
  if (item.branch) console.log(`branch: ${item.branch}`);
  if (item.pr) console.log(`pr: ${item.pr}`);
  if (item.labels.length > 0) console.log(`labels: ${item.labels.join(',')}`);
}

function printJsonItem(item: BoardItem): void {
  console.log(JSON.stringify(item, null, 2));
}

export function printItemCreated(item: BoardItem, format: OutputFormat): void {
  switch (format) {
    case 'human':
      console.log(
        `${ui.success('Created')} #${item.id} ${item.title} (${ui.stateColor(item.state)})`,
      );
      break;
    case 'plain':
      printPlainItem(item);
      break;
    case 'json':
      printJsonItem(item);
      break;
  }
}

function printDetailField(label: string, value: string): void {
  console.log(`  ${ui.dim(label.padEnd(13))}${value}`);
}

function printTransitions(transitions: Transition[]): void {
  console.log('');
  console.log(`  ${ui.dim('Transitions')}`);
  for (const t of transitions) {
    const from = ui.stateColor(t.from);
    const to = ui.stateColor(t.to);
    const trigger = t.trigger;
    const actor = t.actor ? `by ${t.actor}` : '';
    const date = ui.shortDate(t.at);
    console.log(`    ${from} ${ui.dim('→')} ${to}   ${trigger}   ${ui.dim(actor)}   ${ui.dim(date)}`);
  }
}

function printReviews(reviews: Review[]): void {
  console.log('');
  console.log(`  ${ui.dim('Reviews')}`);
  for (const r of reviews) {
    const icon = r.verdict === 'approved' ? ui.success('✓') : ui.error('✗');
    const verdict = r.verdict;
    const summary = r.summary ? `"${r.summary}"` : '';
    const date = ui.shortDate(r.at);
    console.log(`    ${icon} ${verdict}   ${summary}   ${ui.dim(date)}`);
  }
}

export function printItemDetail(item: BoardItem, format: OutputFormat): void {
  switch (format) {
    case 'human': {
      // Title box
      const titleLine = ui.heading(`#${item.id}  ${item.title}`);
      const titlePlain = `#${item.id}  ${item.title}`;
      const subtitleParts = [
        ui.workTypeColor(item.type),
        ui.stateColor(item.state),
        `autonomy ${item.autonomy}`,
      ];
      const subtitlePlainParts = [item.type, item.state, `autonomy ${item.autonomy}`];
      const subtitleLine = subtitleParts.join(ui.dim(' · '));
      const subtitlePlain = subtitlePlainParts.join(' · ');

      ui.box([titleLine, subtitleLine], [titlePlain, subtitlePlain]);

      // Description (if set)
      if (item.description) {
        console.log('');
        console.log(`  ${item.description}`);
      }

      // Metadata fields (only show non-empty)
      console.log('');
      if (item.assignee) printDetailField('Assignee', item.assignee);
      if (item.complexity) printDetailField('Complexity', item.complexity);
      if (item.milestone) printDetailField('Milestone', item.milestone);
      if (item.spec_path) printDetailField('Spec', item.spec_path);
      if (item.branch) printDetailField('Branch', item.branch);
      if (item.pr) printDetailField('PR', item.pr);
      if (item.labels.length > 0) printDetailField('Labels', item.labels.join(', '));
      if (item.blocked_reason) printDetailField('Blocked', item.blocked_reason);
      if (item.blocked_by.length > 0) printDetailField('Blocked by', item.blocked_by.map(id => `#${id}`).join(', '));
      if (item.retries > 0) printDetailField('Retries', String(item.retries));
      if (item.agent_sessions > 0) printDetailField('Sessions', String(item.agent_sessions));

      // Dates
      if (item.created_at || item.updated_at) {
        console.log('');
        if (item.created_at) printDetailField('Created', ui.shortDate(item.created_at));
        if (item.updated_at) printDetailField('Updated', ui.shortDate(item.updated_at));
      }

      // Transitions
      if (item.transitions.length > 0) {
        printTransitions(item.transitions);
      }

      // Reviews
      if (item.reviews.length > 0) {
        printReviews(item.reviews);
      }

      // Costs
      const c = item.costs;
      if (c && (c.tokens_in || c.tokens_out || c.api_cost || c.agent_wall_time || c.dev_gate_time || c.dev_review_time)) {
        console.log('');
        console.log(`  ${ui.dim('Costs')}`);
        if (c.tokens_in) printDetailField('Tokens in', c.tokens_in.toLocaleString());
        if (c.tokens_out) printDetailField('Tokens out', c.tokens_out.toLocaleString());
        if (c.api_cost) printDetailField('API cost', `$${c.api_cost.toFixed(4)}`);
        if (c.agent_wall_time) printDetailField('Agent time', `${c.agent_wall_time}s`);
        if (c.dev_gate_time) printDetailField('Gate time', `${c.dev_gate_time}s`);
        if (c.dev_review_time) printDetailField('Review time', `${c.dev_review_time}s`);
      }

      console.log('');
      break;
    }
    case 'plain':
      printPlainItem(item);
      break;
    case 'json':
      printJsonItem(item);
      break;
  }
}

export function printItemList(items: BoardItem[], format: OutputFormat): void {
  switch (format) {
    case 'human':
      if (items.length === 0) {
        console.log('No items.');
        return;
      }

      // Dynamic column widths
      const maxTitle = Math.min(60, Math.max(30, ...items.map(i => i.title.length)));
      const maxAssignee = Math.max(8, ...items.map(i => (i.assignee || '').length));

      // Header
      console.log('');
      console.log(ui.dim(
        `  ${'#'.padEnd(5)} ${'State'.padEnd(13)} ${'Type'.padEnd(11)} ${'Title'.padEnd(maxTitle + 2)} Assignee`,
      ));
      console.log(ui.dim(`  ${'─'.repeat(5 + 1 + 13 + 1 + 11 + 1 + maxTitle + 2 + 1 + 8)}`));

      // Rows — build each cell with fixed-width plain padding, then apply color
      for (const item of items) {
        const cols = [
          '  ',
          ui.dim(String(item.id).padEnd(5)),
          ' ',
          colorPad(ui.stateColor(item.state as State), item.state, 13),
          ' ',
          colorPad(ui.workTypeColor(item.type), item.type, 11),
          ' ',
          ui.truncate(item.title, maxTitle).padEnd(maxTitle + 2),
          ' ',
          item.assignee || ui.dim('—'),
        ];
        console.log(cols.join(''));
      }
      console.log('');
      break;
    case 'plain':
      for (let i = 0; i < items.length; i++) {
        if (i > 0) console.log('---');
        printPlainItem(items[i]);
      }
      break;
    case 'json':
      console.log(JSON.stringify(items, null, 2));
      break;
  }
}

export function printItemMoved(
  item: BoardItem,
  fromState: State,
  format: OutputFormat,
): void {
  switch (format) {
    case 'human':
      console.log(
        `#${item.id} ${item.title} ${ui.stateColor(fromState)} -> ${ui.stateColor(item.state)}`,
      );
      break;
    case 'plain':
      console.log(`id: ${item.id}`);
      console.log(`from: ${fromState}`);
      console.log(`to: ${item.state}`);
      console.log(`title: ${item.title}`);
      break;
    case 'json':
      printJsonItem(item);
      break;
  }
}

export function printItemUpdated(item: BoardItem, format: OutputFormat): void {
  switch (format) {
    case 'human':
      console.log(`${ui.success('Updated')} #${item.id} ${item.title}`);
      break;
    case 'plain':
      printPlainItem(item);
      break;
    case 'json':
      printJsonItem(item);
      break;
  }
}

export function printItemCancelled(item: BoardItem, format: OutputFormat): void {
  switch (format) {
    case 'human':
      console.log(`${ui.warn('Cancelled')} #${item.id} ${item.title}`);
      break;
    case 'plain':
      printPlainItem(item);
      break;
    case 'json':
      printJsonItem(item);
      break;
  }
}

export function printError(msg: string, format: OutputFormat): void {
  switch (format) {
    case 'human':
      console.error(`${ui.error('error:')} ${msg}`);
      break;
    case 'plain':
      console.error(`error: ${msg}`);
      break;
    case 'json':
      console.error(JSON.stringify({ error: msg }));
      break;
  }
}
