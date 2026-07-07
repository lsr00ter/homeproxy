/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Copyright (C) 2022-2025 ImmortalWrt.org
 */

'use strict';
'require form';
'require fs';
'require poll';
'require rpc';
'require uci';
'require ui';
'require view';

const css = '						\
.hp-log-heading {					\
	align-items: center;				\
	display: flex;					\
	flex-wrap: wrap;				\
	gap: 4px;					\
}							\
.hp-log-heading h3 {					\
	margin-right: 4px;				\
}							\
.hp-log-toolbar {					\
	align-items: center;				\
	display: flex;					\
	flex-wrap: wrap;				\
	gap: 8px;					\
	margin-bottom: 10px;				\
}							\
.hp-log-toolbar label {				\
	margin-right: 4px;				\
}							\
.hp-log-toolbar input[type="number"] {			\
	width: 6em;					\
}							\
.hp-log-scroll {					\
	padding-bottom: 20px;				\
}							\
.hp-log-textarea {					\
	box-sizing: border-box;				\
	font-size: 12px;				\
	min-height: 20em;				\
	width: 100%;					\
}';

const hp_dir = '/var/run/homeproxy';
const runtimeLogViews = [
	{ type: 'homeproxy', name: _('HomeProxy') },
	{ type: 'sing-box-c', name: _('sing-box client'), section: 'config' },
	{ type: 'sing-box-s', name: _('sing-box server'), section: 'server' }
];

function renderLogLevelSelect(viewCtx, o, logView, section_id) {
	if (!logView.section)
		return null;

	const selected = uci.get('homeproxy', logView.section, 'log_level') || 'warn';
	const choices = {
		trace: _('Trace'),
		debug: _('Debug'),
		info: _('Info'),
		warn: _('Warn'),
		error: _('Error'),
		fatal: _('Fatal'),
		panic: _('Panic')
	};

	const log_level_el = E('select', {
		'id': '%s_%s_log_level'.format(o.cbid(section_id), logView.type),
		'class': 'cbi-input-select',
		'style': 'width: 6em;',
		'change': ui.createHandlerFn(viewCtx, (ev) => {
			uci.set('homeproxy', logView.section, 'log_level', ev.target.value);
			return o.map.save(null, true).then(() => {
				ui.changes.apply(true);
			});
		})
	});

	Object.keys(choices).forEach((v) => {
		log_level_el.appendChild(E('option', {
			'value': v,
			'selected': (v === selected) ? '' : null
		}, [ choices[v] ]));
	});

	return log_level_el;
}

function filterLogLines(logContent, filterText, invertFilter, maxRows) {
	const lines = (logContent || '').trim().split(/\r?\n/).filter((line) => line.length);
	let visibleLines = lines;

	if (filterText) {
		visibleLines = lines.filter((line) => {
			const matched = line.includes(filterText);
			return invertFilter ? !matched : matched;
		});
	}

	if (maxRows > 0 && visibleLines.length > maxRows)
		visibleLines = visibleLines.slice(visibleLines.length - maxRows);

	return visibleLines.length ? visibleLines.join('\n') : _('Log is empty.');
}

function updateLogTextarea(textarea, logContent, filterTextInput, filterTextInvert, filterMaxRows) {
	const maxRows = Math.max(parseInt(filterMaxRows.value || '1000', 10) || 1000, 1);
	const value = filterLogLines(logContent, filterTextInput.value, filterTextInvert.checked, maxRows);

	textarea.value = value;
	textarea.rows = Math.max(value.split(/\n/).length + 1, 5);
}

function renderLogPane(viewCtx, o, logView, section_id, callLogClean) {
	let lastLogContent = '';
	const logId = logView.type.replace(/[^A-Za-z0-9_-]/g, '_');
	const textarea = E('textarea', {
		'id': '%s_log'.format(logId),
		'class': 'hp-log-textarea',
		'readonly': 'readonly',
		'wrap': 'off',
		'rows': 5
	}, [ _('Collecting data...') ]);

	const filterTextInvert = E('input', {
		'id': '%s_invertLogTextSearch'.format(logId),
		'type': 'checkbox',
		'class': 'cbi-input-checkbox'
	});
	const filterTextInput = E('input', {
		'id': '%s_logTextFilter'.format(logId),
		'class': 'cbi-input-text'
	});
	const filterMaxRows = E('input', {
		'id': '%s_logMaxRows'.format(logId),
		'type': 'number',
		'min': '1',
		'class': 'cbi-input',
		'value': '1000'
	});

	const refreshLog = () => {
		updateLogTextarea(textarea, lastLogContent, filterTextInput, filterTextInvert, filterMaxRows);
	};

	filterTextInvert.addEventListener('change', refreshLog);
	filterTextInput.addEventListener('input', refreshLog);
	filterMaxRows.addEventListener('change', refreshLog);

	const scrollDownButton = E('button', {
		'class': 'btn cbi-button cbi-button-neutral',
		'click': ui.createHandlerFn(viewCtx, () => {
			textarea.scrollTop = textarea.scrollHeight;
			scrollUpButton.scrollIntoView();
		})
	}, [ _('Scroll to tail') ]);

	const scrollUpButton = E('button', {
		'class': 'btn cbi-button cbi-button-neutral',
		'click': ui.createHandlerFn(viewCtx, () => {
			textarea.scrollTop = 0;
			scrollDownButton.scrollIntoView();
		})
	}, [ _('Scroll to head') ]);

	poll.add(L.bind(() => {
		return fs.read_direct(String.format('%s/%s.log', hp_dir, logView.type), 'text')
		.then((res) => {
			lastLogContent = res;
			refreshLog();
		}).catch((err) => {
			if (err.toString().includes('NotFoundError'))
				lastLogContent = _('Log file does not exist.');
			else
				lastLogContent = _('Unknown error: %s').format(err);

			refreshLog();
		});
	}));

	return E('div', {
		'data-tab': logView.type,
		'data-tab-title': logView.name
	}, [
		E('div', { 'class': 'hp-log-heading' }, [
			E('h3', { 'name': 'content' }, [ _('%s log').format(logView.name) ]),
			renderLogLevelSelect(viewCtx, o, logView, section_id) || '',
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': ui.createHandlerFn(viewCtx, () => {
					return L.resolveDefault(callLogClean(logView.type), {}).then(() => {
						lastLogContent = '';
						refreshLog();
					});
				})
			}, [ _('Clean log') ])
		]),
		E('div', { 'class': 'hp-log-toolbar' }, [
			E('label', { 'for': filterTextInvert.id }, _('Not')),
			filterTextInvert,
			E('label', { 'for': filterTextInput.id }, _('including:')),
			filterTextInput,
			E('label', { 'for': filterMaxRows.id }, _('Max rows:')),
			filterMaxRows
		]),
		E('div', { 'class': 'hp-log-scroll' }, [ scrollDownButton ]),
		textarea,
		E('div', { 'class': 'hp-log-scroll' }, [ scrollUpButton ])
	]);
}

function renderLogViewer(viewCtx, o, _option_index, section_id, _in_table) {
	const callLogClean = rpc.declare({
		object: 'luci.homeproxy',
		method: 'log_clean',
		params: ['type'],
		expect: { '': {} }
	});

	const panes = runtimeLogViews.map((logView) => {
		return renderLogPane(viewCtx, o, logView, section_id, callLogClean);
	});

	requestAnimationFrame(() => {
		ui.tabs.initTabGroup(panes);
	});

	return E([
		E('style', [ css ]),
		E('div', { 'class': 'cbi-map' }, [
			E('div', { 'class': 'cbi-section' }, [
				E('div', {}, panes),
				E('div', { 'style': 'text-align:right' },
					E('small', {}, _('Refresh every %s seconds.').format(L.env.pollinterval))
				)
			])
		])
	]);
}

return view.extend({
	render() {
		const m = new form.Map('homeproxy');
		const s = m.section(form.NamedSection, 'config', 'homeproxy');
		s.anonymous = true;

		const o = s.option(form.DummyValue, '_runtime_logview');
		o.render = L.bind(renderLogViewer, this, this, o);

		return m.render();
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
