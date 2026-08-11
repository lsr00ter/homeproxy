/*
 * SPDX-License-Identifier: GPL-2.0-only
 *
 * Copyright (C) 2022-2025 ImmortalWrt.org
 */

'use strict';
'require form';
'require fs';
'require uci';
'require ui';
'require view';

'require homeproxy as hp';
'require tools.widgets as widgets';

/* Keep long node labels/addresses from breaking the grid layout on
 * desktop and mobile. Long labels wrap instead of collapsing early,
 * and long unbreakable hostnames wrap instead of overflowing. */
const css = '										\
.cbi-section-table td.cbi-section-table-titles {					\
	min-width: 10em;								\
	overflow-wrap: break-word;							\
	overflow-wrap: anywhere;							\
}											\
.cbi-section-table td.cbi-value-field[data-name="address"] {				\
	max-width: 16em;								\
	overflow-wrap: break-word;							\
	overflow-wrap: anywhere;							\
}											\
.homeproxy-node-pager {								\
	display: flex;									\
	align-items: center;								\
	flex-wrap: wrap;								\
	gap: .5em;									\
	justify-content: space-between;							\
	margin: .5em 0;								\
}											\
.homeproxy-node-filter { flex: 1 1 16em; }						\
.homeproxy-node-filter > input { width: 100%; }					\
.homeproxy-node-page-status { white-space: nowrap; }					\
.homeproxy-sub-tabs { margin-bottom: .75em; }					\
@media screen and (max-width: 600px) {							\
	.cbi-section-table td.cbi-section-table-titles { min-width: 7em; }		\
	.cbi-section-table td.cbi-value-field[data-name="address"] { max-width: 10em; }	\
	.homeproxy-node-pager { align-items: stretch; }					\
	.homeproxy-node-filter { flex-basis: 100%; }					\
}';

const NODE_PAGE_SIZE = 100;

const CBIPagedGridSection = form.GridSection.extend({
	__name__: 'CBI.PagedGridSection',

	page: 0,
	pageSize: NODE_PAGE_SIZE,
	query: '',
	searchTimer: null,
	activeGroup: null,

	cfgsections() {
		let sections = this.getFilteredSections();
		let pageSize = this.pageSize || NODE_PAGE_SIZE;
		let pages = Math.max(Math.ceil(sections.length / pageSize), 1);

		if (this.page >= pages)
			this.page = pages - 1;
		else if (this.page < 0)
			this.page = 0;

		this.filteredSectionCount = sections.length;
		this.totalSectionCount = this.getAllSections().length;

		return sections.slice(this.page * pageSize, (this.page + 1) * pageSize);
	},

	getAllSections() {
		if (Array.isArray(this.groups) && this.groups.length) {
			let group = this.getActiveGroup();
			return group ? group.sections() : [];
		}

		if (typeof this.allsections === 'function')
			return this.allsections();
		else if (Array.isArray(this.allsections))
			return this.allsections;

		return form.GridSection.prototype.cfgsections.apply(this, arguments);
	},

	getActiveGroup() {
		if (!Array.isArray(this.groups) || !this.groups.length)
			return null;

		let group = this.groups.find((item) => item.key === this.activeGroup);
		if (group)
			return group;

		this.activeGroup = this.groups[0].key;
		return this.groups[0];
	},

	getFilteredSections() {
		let query = (this.query || '').trim().toLowerCase();
		let sections = this.getAllSections();

		if (!query)
			return sections;

		return sections.filter((section_id) => {
			let config = this.uciconfig || this.map.config;
			let values = [
				section_id,
				this.titleFn('sectiontitle', section_id),
				uci.get(config, section_id, 'label'),
				uci.get(config, section_id, 'type'),
				uci.get(config, section_id, 'address'),
				uci.get(config, section_id, 'port')
			];

			return values.join(' ').toLowerCase().includes(query);
		});
	},

	handleFilterInput(ev) {
		let value = ev.target.value;

		if (this.searchTimer !== null)
			window.clearTimeout(this.searchTimer);

		this.searchTimer = window.setTimeout(() => {
			this.query = value;
			this.page = 0;
			this.map.reset();
		}, 250);
	},

	handlePage(ev, delta) {
		ev.preventDefault();
		this.page += delta;
		return this.map.reset();
	},

	handleGroup(ev, group) {
		ev.preventDefault();
		this.activeGroup = group.key;
		this.page = 0;
		return this.map.reset();
	},

	renderGroupTabs() {
		if (!Array.isArray(this.groups) || this.groups.length < 2)
			return E([]);

		this.getActiveGroup();

		return E('ul', { 'class': 'cbi-tabmenu homeproxy-sub-tabs' },
			this.groups.map((group) => E('li', {
				'class': (group.key === this.activeGroup) ? 'cbi-tab' : 'cbi-tab-disabled',
				'data-tab': group.key
			}, E('a', {
				'href': '#',
				'click': (ev) => this.handleGroup(ev, group)
			}, [ group.title ]))));
	},

	renderPageControls() {
		let pageSize = this.pageSize || NODE_PAGE_SIZE;
		let total = this.filteredSectionCount || 0;
		let totalSections = this.totalSectionCount || total;
		let pages = Math.max(Math.ceil(total / pageSize), 1);
		let start = total ? (this.page * pageSize) + 1 : 0;
		let end = Math.min((this.page + 1) * pageSize, total);

		if (totalSections <= pageSize && !this.query)
			return E([]);

		return E('div', { 'class': 'homeproxy-node-pager' }, [
			E('span', { 'class': 'control-group homeproxy-node-filter' }, [
				E('input', {
					'type': 'text',
					'class': 'cbi-input-text',
					'placeholder': _('Filter'),
					'value': this.query || '',
					'input': L.bind(this.handleFilterInput, this),
					'keydown': (ev) => {
						if (ev.keyCode === 13)
							ev.preventDefault();
					}
				})
			]),
			E('span', { 'class': 'homeproxy-node-page-status' },
				_('Displaying %d-%d of %d').format(start, end, total)),
			E('span', { 'class': 'control-group' }, [
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button-neutral',
					'aria-label': _('Previous page'),
					'disabled': this.page <= 0 || null,
					'click': (ev) => this.handlePage(ev, -1)
				}, [ '<' ]),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button-neutral',
					'aria-label': _('Next page'),
					'disabled': this.page >= pages - 1 || null,
					'click': (ev) => this.handlePage(ev, 1)
				}, [ '>' ])
			])
		]);
	},

	renderContents(cfgsections, nodes) {
		let sectionEl = form.GridSection.prototype.renderContents.apply(this, arguments);
		let tableEl = sectionEl.querySelector('table.cbi-section-table');

		if (tableEl) {
			sectionEl.insertBefore(this.renderGroupTabs(), tableEl);
			sectionEl.insertBefore(this.renderPageControls(), tableEl);
		}

		return sectionEl;
	},

	handleAdd() {
		delete this.map.homeproxyNodeGroups;
		return form.GridSection.prototype.handleAdd.apply(this, arguments);
	},

	handleRemove() {
		delete this.map.homeproxyNodeGroups;
		return form.GridSection.prototype.handleRemove.apply(this, arguments);
	},

	handleModalSave() {
		delete this.map.homeproxyNodeGroups;
		return form.GridSection.prototype.handleModalSave.apply(this, arguments);
	},

	handleModalCancel() {
		delete this.map.homeproxyNodeGroups;
		return form.GridSection.prototype.handleModalCancel.apply(this, arguments);
	}
});

function loadNodeGroups(map, uciconfig, subinfo) {
	if (map.homeproxyNodeGroups)
		return map.homeproxyNodeGroups;

	let groups = {
		user: [],
		subscriptions: {}
	};

	for (let hash of Object.keys(subinfo))
		groups.subscriptions[hash] = [];

	uci.sections(uciconfig, 'node', (res) => {
		let grouphash = res.grouphash;

		if (grouphash && groups.subscriptions[grouphash])
			groups.subscriptions[grouphash].push(res['.name']);
		else
			groups.user.push(res['.name']);
	});

	map.homeproxyNodeGroups = groups;
	return groups;
}

function setupPagedNodeSection(section, map, uciconfig, subinfo, getSections) {
	section.pageSize = NODE_PAGE_SIZE;
	section.allsections = () => getSections(loadNodeGroups(map, uciconfig, subinfo));
}

function setupGroupedNodeSection(section, map, uciconfig, subinfo) {
	section.pageSize = NODE_PAGE_SIZE;
	section.groups = Object.keys(subinfo).map((hash) => ({
		key: hash,
		title: _('Sub (%s)').format(subinfo[hash]),
		sections: () => loadNodeGroups(map, uciconfig, subinfo).subscriptions[hash] || []
	}));
}

function allowInsecureConfirm(ev, _section_id, value) {
	if (value === '1' && !confirm(_('Are you sure to allow insecure?')))
		ev.target.firstElementChild.checked = null;
}

const shadowsocks_stream_encrypt_methods = [
	'aes-128-ctr',
	'aes-192-ctr',
	'aes-256-ctr',
	'aes-128-cfb',
	'aes-192-cfb',
	'aes-256-cfb',
	'chacha20',
	'chacha20-ietf',
	'rc4-md5'
];

function validateShadowsocksPassword(method, section_id, value) {
	if (method === 'none')
		return true;

	if (!value)
		return _('Expecting: %s').format(_('non-empty value'));

	const key_length = hp.shadowsocks_encrypt_length[method];
	if (key_length) {
		const base64_length = Math.ceil(key_length / 3) * 4;
		for (const key of value.split(':')) {
			const result = key && hp.validateBase64Key(base64_length, section_id, key);
			if (result !== true)
				return result || _('Expecting: %s').format(
					_('valid base64 key with %d characters').format(base64_length));
		}
	}

	return true;
}

function validateShadowsocksConfig(config) {
	if (!config || !config.address || !config.port || !config.shadowsocks_encrypt_method)
		return null;

	if (!hp.shadowsocks_encrypt_methods.includes(config.shadowsocks_encrypt_method) &&
	    !shadowsocks_stream_encrypt_methods.includes(config.shadowsocks_encrypt_method))
		return null;

	if (validateShadowsocksPassword(config.shadowsocks_encrypt_method, 'shadowsocks', config.password) !== true)
		return null;

	if (config.shadowtls_enabled === '1') {
		if (!config.shadowtls_address || !config.shadowtls_port ||
		    !['1', '2', '3'].includes(config.shadowtls_version))
			return null;

		if (config.shadowtls_version !== '1' && !config.shadowtls_password)
			return null;
	}

	if (!config.label) {
		const address = config.address.replace(/^\[(.*)\]$/, '$1');
		config.label = (address.includes(':') ? '[' + address + ']' : address) + ':' + config.port;
	}

	return config;
}

function parseShadowTLSPlugin(plugin, plugin_opts, address, port) {
	if (!plugin || !['shadow-tls', 'shadowtls'].includes(plugin.toLowerCase()))
		return null;

	const options = {};
	for (const option of (plugin_opts || '').split(';')) {
		const parts = option.split('='), key = parts.shift()?.toLowerCase();
		if (key)
			options[key] = parts.join('=');
	}

	let version = ('version' in options) ? options.version : '1';
	for (const value of ['1', '2', '3'])
		if (options['v' + value] === '1')
			version = value;

	return {
		shadowtls_enabled: '1',
		shadowtls_address: address,
		shadowtls_port: port,
		shadowtls_version: version,
		shadowtls_password: options.password || options.passwd,
		shadowtls_sni: options.host || options.sni
	};
}

function normalizeShadowsocksEndpoint(address, port) {
	if (address == null || port == null)
		return null;

	address = String(address).trim().replace(/^\[(.*)\]$/, '$1');
	port = String(port).trim();
	if (!address || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
		return null;

	try {
		const host = address.includes(':') ? '[' + address + ']' : address;
		const url = new URL('http://' + host + ':' + port);
		if (!url.hostname || url.pathname !== '/' || url.search || url.hash || url.username || url.password)
			return null;
	} catch(e) {
		return null;
	}

	return { address: address, port: String(Number(port)) };
}

function parseShadowsocksEndpoint(endpoint, outer_port) {
	if (typeof endpoint !== 'string')
		return null;

	endpoint = endpoint.trim();
	let match;
	if (outer_port != null) {
		match = endpoint.match(/^\[([^\]]+)\]$/);
		if (!match && endpoint.includes(':'))
			return null;
		return normalizeShadowsocksEndpoint(match ? match[1] : endpoint, outer_port);
	}

	match = endpoint.match(/^\[([^\]]+)\]:(\d+)$/);
	if (match)
		return normalizeShadowsocksEndpoint(match[1], match[2]);

	match = endpoint.match(/^([^:]+):(\d+)$/);
	return match ? normalizeShadowsocksEndpoint(match[1], match[2]) : null;
}

function decodeShadowsocksEnvelope(value) {
	try {
		return hp.decodeBase64Str(decodeURIComponent(value).replace(/ /g, '+'));
	} catch(e) {
		return null;
	}
}

function makeShadowsocksAuthorityConfig(credentials, endpoint) {
	const separator = credentials.indexOf(':');
	if (separator <= 0 || !endpoint)
		return null;

	return {
		type: 'shadowsocks',
		address: endpoint.address,
		port: endpoint.port,
		shadowsocks_encrypt_method: credentials.slice(0, separator).toLowerCase(),
		password: credentials.slice(separator + 1)
	};
}

function parseShadowsocksBase64Authority(authority) {
	const separator = authority.lastIndexOf('@');
	if (separator > 0) {
		const credentials = decodeShadowsocksEnvelope(authority.slice(0, separator));
		const endpoint = parseShadowsocksEndpoint(authority.slice(separator + 1));
		if (credentials && endpoint)
			return makeShadowsocksAuthorityConfig(credentials, endpoint);
	}

	const decoded = decodeShadowsocksEnvelope(authority);
	if (decoded) {
		const decoded_separator = decoded.lastIndexOf('@');
		if (decoded_separator > 0) {
			const endpoint = parseShadowsocksEndpoint(decoded.slice(decoded_separator + 1));
			if (endpoint)
				return makeShadowsocksAuthorityConfig(decoded.slice(0, decoded_separator), endpoint);
		}
	}

	const outer = authority.match(/^(.+):(\d+)$/);
	if (!outer)
		return null;

	const decoded_outer = decodeShadowsocksEnvelope(outer[1]);
	const decoded_separator = decoded_outer?.lastIndexOf('@') ?? -1;
	if (decoded_separator <= 0)
		return null;

	const endpoint = parseShadowsocksEndpoint(decoded_outer.slice(decoded_separator + 1), outer[2]);
	return makeShadowsocksAuthorityConfig(decoded_outer.slice(0, decoded_separator), endpoint);
}

function splitShadowsocksShareLink(uri) {
	let label = null, query = null;
	const fragment = uri.indexOf('#');
	if (fragment >= 0) {
		try {
			label = decodeURIComponent(uri.slice(fragment + 1));
		} catch(e) {
			label = uri.slice(fragment + 1);
		}
		uri = uri.slice(0, fragment);
	}

	const search = uri.indexOf('?');
	if (search >= 0) {
		query = uri.slice(search + 1);
		uri = uri.slice(0, search);
	}

	return { authority: uri, query: query, label: label };
}

function parseShadowTLSQuery(params, address, port) {
	let value = null;
	if (params.has('shadow-tls'))
		value = params.get('shadow-tls');
	else if (params.has('shadowtls'))
		value = params.get('shadowtls');
	else
		return undefined;

	const decoded = (typeof value === 'string') ? decodeShadowsocksEnvelope(value) : null;
	if (!decoded)
		return null;

	let options;
	try {
		options = JSON.parse(decoded);
	} catch(e) {
		return null;
	}
	if (!options || typeof options !== 'object' || Array.isArray(options))
		return null;

	const version = String(options.version);
	if (!['1', '2', '3'].includes(version))
		return null;
	if ('password' in options && typeof options.password !== 'string')
		return null;
	if (version !== '1' && !options.password)
		return null;
	if ('host' in options && typeof options.host !== 'string')
		return null;
	if ('address' in options && typeof options.address !== 'string')
		return null;
	if ('port' in options && !['number', 'string'].includes(typeof options.port))
		return null;

	const endpoint = normalizeShadowsocksEndpoint(
		('address' in options) ? options.address : address,
		('port' in options) ? options.port : port
	);
	if (!endpoint)
		return null;

	return {
		shadowtls_enabled: '1',
		shadowtls_address: endpoint.address,
		shadowtls_port: endpoint.port,
		shadowtls_version: version,
		shadowtls_password: options.password,
		shadowtls_sni: options.host
	};
}

function applyShadowsocksShareOptions(config, params) {
	let plugin, plugin_opts;
	if (params.has('plugin')) {
		const plugin_info = params.get('plugin').split(';');
		plugin = (plugin_info[0] === 'simple-obfs') ? 'obfs-local' : plugin_info[0];
		plugin_opts = (plugin_info.length > 1) ? plugin_info.slice(1).join(';') : null;
	}

	config.shadowsocks_plugin = plugin;
	config.shadowsocks_plugin_opts = plugin_opts;
	const plugin_shadowtls = parseShadowTLSPlugin(plugin, plugin_opts, config.address, config.port);
	if (plugin_shadowtls) {
		Object.assign(config, plugin_shadowtls);
		delete config.shadowsocks_plugin;
		delete config.shadowsocks_plugin_opts;
	}

	const query_shadowtls = parseShadowTLSQuery(params, config.address, config.port);
	if (query_shadowtls === null)
		return null;
	if (query_shadowtls) {
		Object.assign(config, query_shadowtls);
		delete config.shadowsocks_plugin;
		delete config.shadowsocks_plugin_opts;
	}

	return validateShadowsocksConfig(config);
}

function parseShadowsocksLegacyUri(uri, label) {
	uri = uri.trim();

	let userinfo, server, parts = uri.split('@');
	if (parts.length < 2)
		return null;
	else if (parts.length > 2)
		parts = [ parts.slice(0, -1).join('@'), parts.slice(-1).toString() ];

	userinfo = parts[0].split(':');
	if (userinfo.length < 2)
		return null;

	server = parts[1].match(/^\[?(.+?)\]?:(\d+)$/);
	if (!server)
		return null;

	return validateShadowsocksConfig({
		label: label,
		type: 'shadowsocks',
		address: server[1],
		port: server[2],
		shadowsocks_encrypt_method: userinfo[0],
		password: userinfo.slice(1).join(':')
	});
}

function parseShadowsocksShareLink(uri) {
	let parts = splitShadowsocksShareLink(uri);
	let config = parseShadowsocksBase64Authority(parts.authority);
	if (config) {
		config.label = parts.label;
		return applyShadowsocksShareOptions(config, new URLSearchParams(parts.query || ''));
	}

	const decoded = decodeShadowsocksEnvelope(parts.authority);
	if (decoded) {
		const decoded_parts = splitShadowsocksShareLink(decoded.trim());
		parts.authority = decoded_parts.authority;
		parts.query = (parts.query == null) ? decoded_parts.query : parts.query;
		parts.label = (parts.label == null) ? decoded_parts.label : parts.label;
	}

	const params = new URLSearchParams(parts.query || '');
	try {
		/* SIP002 format https://shadowsocks.org/guide/sip002.html */
		const url = new URL('http://' + parts.authority);
		let userinfo;
		if (url.username && url.password) {
			/* User info encoded with URIComponent */
			userinfo = [decodeURIComponent(url.username), decodeURIComponent(url.password)];
		} else if (url.username) {
			/* User info encoded with base64 */
			const decoded_userinfo = decodeShadowsocksEnvelope(url.username);
			const separator = decoded_userinfo?.indexOf(':') ?? -1;
			if (separator > 0)
				userinfo = [decoded_userinfo.slice(0, separator), decoded_userinfo.slice(separator + 1)];
		}

		if (userinfo) {
			config = {
				label: parts.label,
				type: 'shadowsocks',
				address: url.hostname,
				port: url.port || '80',
				shadowsocks_encrypt_method: userinfo[0].toLowerCase(),
				password: userinfo[1]
			};
			return applyShadowsocksShareOptions(config, params);
		}
	} catch(e) { }

	/* Legacy format https://github.com/shadowsocks/shadowsocks-org/commit/78ca46cd6859a4e9475953ed34a2d301454f579e */
	config = parseShadowsocksLegacyUri(parts.authority, parts.label);
	return config ? applyShadowsocksShareOptions(config, params) : null;
}

function parseShareLink(uri, features) {
	let config, url, params;

	uri = uri.split('://');
	if (uri[0] && uri[1]) {
		switch (uri[0]) {
		case 'anytls':
			/* https://github.com/anytls/anytls-go/blob/v0.0.8/docs/uri_scheme.md */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			/* Check if password exists */
			if (!url.username)
				return null;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'anytls',
				address: url.hostname,
				port: url.port || '80',
				password: url.username ? decodeURIComponent(url.username) : null,
				tls: '1',
				tls_sni: params.get('sni'),
				tls_insecure: (params.get('insecure') === '1') ? '1' : '0'
			};

			break;
		case 'http':
		case 'https':
			url = new URL('http://' + uri[1]);

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'http',
				address: url.hostname,
				port: url.port || '80',
				username: url.username ? decodeURIComponent(url.username) : null,
				password: url.password ? decodeURIComponent(url.password) : null,
				tls: (uri[0] === 'https') ? '1' : '0'
			};

			break;
		case 'hysteria':
			/* https://github.com/HyNetwork/hysteria/wiki/URI-Scheme */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			/* WeChat-Video / FakeTCP are unsupported by sing-box currently */
			if (!features.with_quic || (params.get('protocol') && params.get('protocol') !== 'udp'))
				return null;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'hysteria',
				address: url.hostname,
				port: url.port || '80',
				hysteria_protocol: params.get('protocol') || 'udp',
				hysteria_auth_type: params.get('auth') ? 'string' : null,
				hysteria_auth_payload: params.get('auth'),
				hysteria_obfs_password: params.get('obfsParam'),
				hysteria_down_mbps: params.get('downmbps'),
				hysteria_up_mbps: params.get('upmbps'),
				tls: '1',
				tls_sni: params.get('peer'),
				tls_alpn: params.get('alpn'),
				tls_insecure: (params.get('insecure') === '1') ? '1' : '0'
			};

			break;
		case 'hysteria2':
		case 'hy2':
			/* https://v2.hysteria.network/docs/developers/URI-Scheme/ */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			if (!features.with_quic)
				return null;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'hysteria2',
				address: url.hostname,
				port: url.port || '80',
				password: url.username ? (
					decodeURIComponent(url.username + (url.password ? (':' + url.password) : ''))
				) : null,
				hysteria_obfs_type: params.get('obfs'),
				hysteria_obfs_password: params.get('obfs-password'),
				tls: '1',
				tls_sni: params.get('sni'),
				tls_insecure: params.get('insecure') ? '1' : '0'
			};

			break;
		case 'socks':
		case 'socks4':
		case 'socks4a':
		case 'socsk5':
		case 'socks5h':
			url = new URL('http://' + uri[1]);

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'socks',
				address: url.hostname,
				port: url.port || '80',
				username: url.username ? decodeURIComponent(url.username) : null,
				password: url.password ? decodeURIComponent(url.password) : null,
				socks_version: (uri[0].includes('4')) ? '4' : '5'
			};

			break;
		case 'ss':
			config = parseShadowsocksShareLink(uri[1]);

			break;
		case 'trojan':
			/* https://p4gefau1t.github.io/trojan-go/developer/url/ */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			/* Check if password exists */
			if (!url.username)
				return null;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'trojan',
				address: url.hostname,
				port: url.port || '80',
				password: decodeURIComponent(url.username),
				transport: params.get('type') !== 'tcp' ? params.get('type') : null,
				tls: '1',
				tls_sni: params.get('sni')
			};
			switch (params.get('type')) {
			case 'grpc':
				config.grpc_servicename = params.get('serviceName');
				break;
			case 'ws':
				config.ws_host = params.get('host') ? decodeURIComponent(params.get('host')) : null;
				config.ws_path = params.get('path') ? decodeURIComponent(params.get('path')) : null;
				if (config.ws_path && config.ws_path.includes('?ed=')) {
					config.websocket_early_data_header = 'Sec-WebSocket-Protocol';
					config.websocket_early_data = config.ws_path.split('?ed=')[1];
					config.ws_path = config.ws_path.split('?ed=')[0];
				}
				break;
			}

			break;
		case 'tuic':
			/* https://github.com/daeuniverse/dae/discussions/182 */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			/* Check if uuid exists */
			if (!url.username)
				return null;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'tuic',
				address: url.hostname,
				port: url.port || '80',
				uuid: url.username,
				password: url.password ? decodeURIComponent(url.password) : null,
				tuic_congestion_control: params.get('congestion_control'),
				tuic_udp_relay_mode: params.get('udp_relay_mode'),
				tls: '1',
				tls_sni: params.get('sni'),
				tls_alpn: params.get('alpn') ? decodeURIComponent(params.get('alpn')).split(',') : null
			};

			break;
		case 'vless':
			/* https://github.com/XTLS/Xray-core/discussions/716 */
			url = new URL('http://' + uri[1]);
			params = url.searchParams;

			/* Unsupported protocol */
			if (params.get('type') === 'kcp')
				return null;
			else if (params.get('type') === 'quic' && ((params.get('quicSecurity') && params.get('quicSecurity') !== 'none') || !features.with_quic))
				return null;
			/* Check if uuid and type exist */
			if (!url.username || !params.get('type'))
				return null;

			config = {
				label: url.hash ? decodeURIComponent(url.hash.slice(1)) : null,
				type: 'vless',
				address: url.hostname,
				port: url.port || '80',
				uuid: url.username,
				transport: params.get('type') !== 'tcp' ? params.get('type') : null,
				tls: ['tls', 'xtls', 'reality'].includes(params.get('security')) ? '1' : '0',
				tls_sni: params.get('sni'),
				tls_alpn: params.get('alpn') ? decodeURIComponent(params.get('alpn')).split(',') : null,
				tls_reality: (params.get('security') === 'reality') ? '1' : '0',
				tls_reality_public_key: params.get('pbk') ? decodeURIComponent(params.get('pbk')) : null,
				tls_reality_short_id: params.get('sid'),
				tls_utls: features.with_utls ? params.get('fp') : null,
				vless_flow: ['tls', 'reality'].includes(params.get('security')) ? params.get('flow') : null
			};
			switch (params.get('type')) {
			case 'grpc':
				config.grpc_servicename = params.get('serviceName');
				break;
			case 'http':
			case 'tcp':
				if (config.transport === 'http' || params.get('headerType') === 'http') {
					config.http_host = params.get('host') ? decodeURIComponent(params.get('host')).split(',') : null;
					config.http_path = params.get('path') ? decodeURIComponent(params.get('path')) : null;
				}
				break;
			case 'httpupgrade':
				config.httpupgrade_host = params.get('host') ? decodeURIComponent(params.get('host')) : null;
				config.http_path = params.get('path') ? decodeURIComponent(params.get('path')) : null;
				break;
			case 'ws':
				config.ws_host = params.get('host') ? decodeURIComponent(params.get('host')) : null;
				config.ws_path = params.get('path') ? decodeURIComponent(params.get('path')) : null;
				if (config.ws_path && config.ws_path.includes('?ed=')) {
					config.websocket_early_data_header = 'Sec-WebSocket-Protocol';
					config.websocket_early_data = config.ws_path.split('?ed=')[1];
					config.ws_path = config.ws_path.split('?ed=')[0];
				}
				break;
			}

			break;
		case 'vmess':
			/* "Lovely" shadowrocket format */
			if (uri.includes('&'))
				return null;

			/* https://github.com/2dust/v2rayN/wiki/Description-of-VMess-share-link */
			uri = JSON.parse(hp.decodeBase64Str(uri[1]));

			if (uri.v != '2')
				return null;
			/* Unsupported protocols */
			else if (uri.net === 'kcp')
				return null;
			else if (uri.net === 'quic' && ((uri.type && uri.type !== 'none') || !features.with_quic))
				return null;
			/* https://www.v2fly.org/config/protocols/vmess.html#vmess-md5-%E8%AE%A4%E8%AF%81%E4%BF%A1%E6%81%AF-%E6%B7%98%E6%B1%B0%E6%9C%BA%E5%88%B6
			 * else if (uri.aid && parseInt(uri.aid) !== 0)
			 * 	return null;
			 */

			config = {
				label: uri.ps,
				type: 'vmess',
				address: uri.add,
				port: uri.port,
				uuid: uri.id,
				vmess_alterid: uri.aid,
				vmess_encrypt: uri.scy || 'auto',
				transport: (uri.net !== 'tcp') ? uri.net : null,
				tls: uri.tls === 'tls' ? '1' : '0',
				tls_sni: uri.sni || uri.host,
				tls_alpn: uri.alpn ? uri.alpn.split(',') : null,
				tls_utls: features.with_utls ? uri.fp : null
			};
			switch (uri.net) {
			case 'grpc':
				config.grpc_servicename = uri.path;
				break;
			case 'h2':
			case 'tcp':
				if (uri.net === 'h2' || uri.type === 'http') {
					config.transport = 'http';
					config.http_host = uri.host ? uri.host.split(',') : null;
					config.http_path = uri.path;
				}
				break;
			case 'httpupgrade':
				config.httpupgrade_host = uri.host;
				config.http_path = uri.path;
				break;
			case 'ws':
				config.ws_host = uri.host;
				config.ws_path = uri.path;
				if (config.ws_path && config.ws_path.includes('?ed=')) {
					config.websocket_early_data_header = 'Sec-WebSocket-Protocol';
					config.websocket_early_data = config.ws_path.split('?ed=')[1];
					config.ws_path = config.ws_path.split('?ed=')[0];
				}
				break;
			}

			break;
		}
	}

	if (config) {
		if (!config.address || !config.port)
			return null;
		else if (!config.label)
			config.label = config.address + ':' + config.port;

		config.address = config.address.replace(/\[|\]/g, '');
	}

	return config;
}

function toArray(value) {
	if (!value)
		return [];

	return Array.isArray(value) ? value : [ value ];
}

function removeNodeReferences(config, section_ids) {
	if (!section_ids.length)
		return;

	if (section_ids.includes(uci.get(config, 'config', 'main_node')))
		uci.set(config, 'config', 'main_node', 'nil');

	if (section_ids.includes(uci.get(config, 'config', 'main_udp_node')))
		uci.set(config, 'config', 'main_udp_node', 'nil');

	for (let opt of [ 'main_urltest_nodes', 'main_udp_urltest_nodes' ]) {
		let nodes = toArray(uci.get(config, 'config', opt)),
		    kept = nodes.filter((node) => !section_ids.includes(node));

		if (kept.length !== nodes.length) {
			if (kept.length)
				uci.set(config, 'config', opt, kept);
			else
				uci.unset(config, 'config', opt);
		}
	}

	uci.sections(config, 'routing_node', (res) => {
		let nodes = toArray(res.urltest_nodes),
		    kept = nodes.filter((node) => !section_ids.includes(node));

		if (kept.length !== nodes.length) {
			if (kept.length)
				uci.set(config, res['.name'], 'urltest_nodes', kept);
			else
				uci.unset(config, res['.name'], 'urltest_nodes');
		}
	});
}

/* Drop subscription nodes whose subscription URL is no longer configured.
 * Returns the number of removed nodes. */
function cleanupInactiveSubscriptionNodes(config) {
	let activeHashes = {},
	    removedNodes = [];

	for (let suburl of toArray(uci.get(config, 'subscription', 'subscription_url')))
		if (suburl)
			activeHashes[hp.calcStringMD5(suburl.replace(/#.*$/, ''))] = true;

	uci.sections(config, 'node', (res) => {
		if (res.grouphash && !activeHashes[res.grouphash]) {
			removedNodes.push(res['.name']);
			uci.remove(config, res['.name']);
		}
	});

	removeNodeReferences(config, removedNodes);

	return removedNodes.length;
}

function renderNodeSettings(section, data, features, main_node, routing_mode, subinfo) {
	let s = section, o;
	const formatSectionLabel = (section_id, fallback) => hp.formatNodeLabel({
		label: uci.get(data[0], section_id, 'label'),
		grouphash: uci.get(data[0], section_id, 'grouphash')
	}, subinfo, fallback);

	s.rowcolors = true;
	s.sortable = true;
	s.nodescriptions = true;
	s.modaltitle = function(section_id) {
		if (!uci.get(data[0], section_id, 'type'))
			return _('Add a node');

		const label = formatSectionLabel(section_id, hp.loadDefaultLabel(data[0], section_id));

		return _('Node') + ' ' + String.fromCharCode(187) + ' ' + label;
	};
	s.sectiontitle = function(section_id) {
		const label = hp.loadDefaultLabel(data[0], section_id);

		return formatSectionLabel(section_id, label);
	};
	s.handleRemove = function(section_id) {
		removeNodeReferences(data[0], [ section_id ]);

		return form.GridSection.prototype.handleRemove.apply(this, arguments);
	}

	if (routing_mode !== 'custom') {
		o = s.option(form.Button, '_apply', _('Apply'));
		o.editable = true;
		o.modalonly = false;
		o.inputstyle = 'apply';
		o.inputtitle = function(section_id) {
			if (main_node == section_id) {
				this.readonly = true;
				return _('Applied');
			} else {
				this.readonly = false;
				return _('Apply');
			}
		}
		o.onclick = function(ev, section_id) {
			uci.set(data[0], 'config', 'main_node', section_id);

			return this.map.save(null, true).then(() => {
				ui.changes.apply(true);
			});
		}
	}

	o = s.option(form.Value, 'label', _('Label'));
	o.load = L.bind(hp.loadDefaultLabel, this, data[0]);
	o.validate = L.bind(hp.validateUniqueValue, this, data[0], 'node', 'label');
	o.modalonly = true;

	o = s.option(form.ListValue, 'type', _('Type'));
	o.value('direct', _('Direct'));
	o.value('anytls', _('AnyTLS'));
	o.value('http', _('HTTP'));
	if (features.with_quic) {
		o.value('hysteria', _('Hysteria'));
		o.value('hysteria2', _('Hysteria2'));
	}
	o.value('shadowsocks', _('Shadowsocks'));
	o.value('shadowtls', _('ShadowTLS'));
	o.value('socks', _('Socks'));
	o.value('ssh', _('SSH'));
	o.value('trojan', _('Trojan'));
	if (features.with_quic)
		o.value('tuic', _('Tuic'));
	if (features.with_wireguard && features.with_gvisor)
		o.value('wireguard', _('WireGuard'));
	o.value('vless', _('VLESS'));
	o.value('vmess', _('VMess'));
	o.rmempty = false;

	o = s.option(form.Value, 'address', _('Address'));
	o.datatype = 'host';
	o.depends({'type': 'direct', '!reverse': true});
	o.rmempty = false;

	o = s.option(form.Value, 'port', _('Port'));
	o.datatype = 'port';
	o.depends({'type': 'direct', '!reverse': true});
	o.rmempty = false;

	o = s.option(form.Value, 'username', _('Username'));
	o.depends('type', 'http');
	o.depends('type', 'socks');
	o.depends('type', 'ssh');
	o.modalonly = true;

	o = s.option(form.Value, 'password', _('Password'));
	o.password = true;
	o.depends('type', 'anytls');
	o.depends('type', 'http');
	o.depends('type', 'hysteria2');
	o.depends('type', 'shadowsocks');
	o.depends('type', 'ssh');
	o.depends('type', 'trojan');
	o.depends('type', 'tuic');
	o.depends({'type': 'shadowtls', 'shadowtls_version': '2'});
	o.depends({'type': 'shadowtls', 'shadowtls_version': '3'});
	o.depends({'type': 'socks', 'socks_version': '5'});
	o.validate = function(section_id, value) {
		if (section_id) {
			const type = this.section.formvalue(section_id, 'type');
			if (type === 'shadowsocks') {
				const method = this.section.formvalue(section_id, 'shadowsocks_encrypt_method');
				return validateShadowsocksPassword(method, section_id, value);
			}

			if (type === 'shadowtls') {
				const version = this.section.formvalue(section_id, 'shadowtls_version');
				if (version === '1')
					return true;
			}

			if (['anytls', 'shadowtls', 'trojan'].includes(type) && !value)
				return _('Expecting: %s').format(_('non-empty value'));
		}

		return true;
	}
	o.modalonly = true;

	/* Direct config */
	o = s.option(form.ListValue, 'proxy_protocol', _('Proxy protocol'),
		_('Write proxy protocol in the connection header.'));
	o.value('', _('Disable'));
	o.value('1', _('v1'));
	o.value('2', _('v2'));
	o.depends('type', 'direct');
	o.modalonly = true;

	/* AnyTLS config start */
	o = s.option(form.Value, 'anytls_idle_session_check_interval', _('Idle session check interval'),
		_('Interval checking for idle sessions, in seconds.'));
	o.datatype = 'uinteger';
	o.placeholder = '30';
	o.depends('type', 'anytls');
	o.modalonly = true;

	o = s.option(form.Value, 'anytls_idle_session_timeout', _('Idle session check timeout'),
		_('In the check, close sessions that have been idle for longer than this, in seconds.'));
	o.datatype = 'uinteger';
	o.placeholder = '30';
	o.depends('type', 'anytls');
	o.modalonly = true;

	o = s.option(form.Value, 'anytls_min_idle_session', _('Minimum idle sessions'),
		_('In the check, at least the first <code>n</code> idle sessions are kept open.'));
	o.datatype = 'uinteger';
	o.placeholder = '0';
	o.depends('type', 'anytls');
	o.modalonly = true;
	/* AnyTLS config end */

	/* Hysteria (2) config start */
	o = s.option(form.DynamicList, 'hysteria_hopping_port', _('Hopping port'));
	o.depends('type', 'hysteria');
	o.depends('type', 'hysteria2');
	o.validate = hp.validatePortRange;
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_hop_interval', _('Hop interval'),
		_('Port hopping interval in seconds.'));
	o.datatype = 'uinteger';
	o.placeholder = '30';
	o.depends({'type': 'hysteria', 'hysteria_hopping_port': /[\s\S]/});
	o.depends({'type': 'hysteria2', 'hysteria_hopping_port': /[\s\S]/});
	o.modalonly = true;

	o = s.option(form.ListValue, 'hysteria_protocol', _('Protocol'));
	o.value('udp');
	/* WeChat-Video / FakeTCP are unsupported by sing-box currently
	 * o.value('wechat-video');
	 * o.value('faketcp');
	 */
	o.default = 'udp';
	o.depends('type', 'hysteria');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.ListValue, 'hysteria_auth_type', _('Authentication type'));
	o.value('', _('Disable'));
	o.value('base64', _('Base64'));
	o.value('string', _('String'));
	o.depends('type', 'hysteria');
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_auth_payload', _('Authentication payload'));
	o.password = true
	o.depends({'type': 'hysteria', 'hysteria_auth_type': /[\s\S]/});
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.ListValue, 'hysteria_obfs_type', _('Obfuscate type'));
	o.value('', _('Disable'));
	o.value('salamander', _('Salamander'));
	o.depends('type', 'hysteria2');
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_obfs_password', _('Obfuscate password'));
	o.password = true;
	o.depends('type', 'hysteria');
	o.depends({'type': 'hysteria2', 'hysteria_obfs_type': /[\s\S]/});
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_down_mbps', _('Max download speed'),
		_('Max download speed in Mbps.'));
	o.datatype = 'uinteger';
	o.depends('type', 'hysteria');
	o.depends('type', 'hysteria2');
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_up_mbps', _('Max upload speed'),
		_('Max upload speed in Mbps.'));
	o.datatype = 'uinteger';
	o.depends('type', 'hysteria');
	o.depends('type', 'hysteria2');
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_recv_window_conn', _('QUIC stream receive window'),
		_('The QUIC stream-level flow control window for receiving data.'));
	o.datatype = 'uinteger';
	o.depends('type', 'hysteria');
	o.modalonly = true;

	o = s.option(form.Value, 'hysteria_revc_window', _('QUIC connection receive window'),
		_('The QUIC connection-level flow control window for receiving data.'));
	o.datatype = 'uinteger';
	o.depends('type', 'hysteria');
	o.modalonly = true;

	o = s.option(form.Flag, 'hysteria_disable_mtu_discovery', _('Disable Path MTU discovery'),
		_('Disables Path MTU Discovery (RFC 8899). Packets will then be at most 1252 (IPv4) / 1232 (IPv6) bytes in size.'));
	o.depends('type', 'hysteria');
	o.modalonly = true;
	/* Hysteria (2) config end */

	/* Shadowsocks config start */
	o = s.option(form.ListValue, 'shadowsocks_encrypt_method', _('Encrypt method'));
	for (let i of hp.shadowsocks_encrypt_methods)
		o.value(i);
	/* Stream ciphers */
	o.value('aes-128-ctr');
	o.value('aes-192-ctr');
	o.value('aes-256-ctr');
	o.value('aes-128-cfb');
	o.value('aes-192-cfb');
	o.value('aes-256-cfb');
	o.value('chacha20');
	o.value('chacha20-ietf');
	o.value('rc4-md5');
	o.default = 'aes-128-gcm';
	o.depends('type', 'shadowsocks');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Flag, 'shadowtls_enabled', _('Enable ShadowTLS'),
		_('Enable ShadowTLS for this Shadowsocks node. UDP traffic uses the existing ' +
			'Multiplex or UDP over TCP controls.'));
	o.default = o.disabled;
	o.depends('type', 'shadowsocks');
	o.modalonly = true;

	o = s.option(form.Value, 'shadowtls_address', _('ShadowTLS address'));
	o.datatype = 'host';
	o.depends({'type': 'shadowsocks', 'shadowtls_enabled': '1'});
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'shadowtls_port', _('ShadowTLS port'));
	o.datatype = 'port';
	o.depends({'type': 'shadowsocks', 'shadowtls_enabled': '1'});
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.ListValue, 'shadowtls_version', _('ShadowTLS version'));
	o.value('1', _('v1'));
	o.value('2', _('v2'));
	o.value('3', _('v3'));
	o.default = '1';
	o.depends('type', 'shadowtls');
	o.depends({'type': 'shadowsocks', 'shadowtls_enabled': '1'});
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'shadowtls_password', _('ShadowTLS password'));
	o.password = true;
	o.depends({'type': 'shadowsocks', 'shadowtls_enabled': '1', 'shadowtls_version': '2'});
	o.depends({'type': 'shadowsocks', 'shadowtls_enabled': '1', 'shadowtls_version': '3'});
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'shadowtls_sni', _('ShadowTLS SNI'));
	o.depends({'type': 'shadowsocks', 'shadowtls_enabled': '1'});
	o.modalonly = true;

	o = s.option(form.ListValue, 'shadowsocks_plugin', _('Plugin'));
	o.value('', _('none'));
	o.value('obfs-local');
	o.value('v2ray-plugin');
	o.depends({'type': 'shadowsocks', 'shadowtls_enabled': '0'});
	o.modalonly = true;

	o = s.option(form.Value, 'shadowsocks_plugin_opts', _('Plugin opts'));
	o.depends({
		'type': 'shadowsocks',
		'shadowtls_enabled': '0',
		'shadowsocks_plugin': 'obfs-local'
	});
	o.depends({
		'type': 'shadowsocks',
		'shadowtls_enabled': '0',
		'shadowsocks_plugin': 'v2ray-plugin'
	});
	o.modalonly = true;
	/* Shadowsocks config end */

	/* Socks config */
	o = s.option(form.ListValue, 'socks_version', _('Socks version'));
	o.value('4', _('Socks4'));
	o.value('4a', _('Socks4A'));
	o.value('5', _('Socks5'));
	o.default = '5';
	o.depends('type', 'socks');
	o.rmempty = false;
	o.modalonly = true;

	/* SSH config start */
	o = s.option(form.Value, 'ssh_client_version', _('Client version'),
		_('Random version will be used if empty.'));
	o.depends('type', 'ssh');
	o.modalonly = true;

	o = s.option(form.DynamicList, 'ssh_host_key', _('Host key'),
		_('Accept any if empty.'));
	o.depends('type', 'ssh');
	o.modalonly = true;

	o = s.option(form.DynamicList, 'ssh_host_key_algo', _('Host key algorithms'))
	o.depends('type', 'ssh');
	o.modalonly = true;

	o = s.option(form.DynamicList, 'ssh_priv_key', _('Private key'));
	o.password = true;
	o.depends('type', 'ssh');
	o.modalonly = true;

	o = s.option(form.Value, 'ssh_priv_key_pp', _('Private key passphrase'));
	o.password = true;
	o.depends('type', 'ssh');
	o.modalonly = true;
	/* SSH config end */

	/* TUIC config start */
	o = s.option(form.Value, 'uuid', _('UUID'));
	o.password = true;
	o.depends('type', 'tuic');
	o.depends('type', 'vless');
	o.depends('type', 'vmess');
	o.validate = hp.validateUUID;
	o.modalonly = true;

	o = s.option(form.ListValue, 'tuic_congestion_control', _('Congestion control algorithm'),
		_('QUIC congestion control algorithm.'));
	o.value('cubic', _('CUBIC'));
	o.value('new_reno', _('New Reno'));
	o.value('bbr', _('BBR'));
	o.default = 'cubic';
	o.depends('type', 'tuic');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.ListValue, 'tuic_udp_relay_mode', _('UDP relay mode'),
		_('UDP packet relay mode.'));
	o.value('', _('Default'));
	o.value('native', _('Native'));
	o.value('quic', _('QUIC'));
	o.depends('type', 'tuic');
	o.modalonly = true;

	o = s.option(form.Flag, 'tuic_udp_over_stream', _('UDP over stream'),
		_('This is the TUIC port of the UDP over TCP protocol, designed to provide a QUIC stream based UDP relay mode that TUIC does not provide.'));
	o.depends({'type': 'tuic','tuic_udp_relay_mode': ''});
	o.modalonly = true;

	o = s.option(form.Flag, 'tuic_enable_zero_rtt', _('Enable 0-RTT handshake'),
		_('Enable 0-RTT QUIC connection handshake on the client side. This is not impacting much on the performance, as the protocol is fully multiplexed.<br/>' +
			'Disabling this is highly recommended, as it is vulnerable to replay attacks.'));
	o.depends('type', 'tuic');
	o.modalonly = true;

	o = s.option(form.Value, 'tuic_heartbeat', _('Heartbeat interval'),
		_('Interval for sending heartbeat packets for keeping the connection alive (in seconds).'));
	o.datatype = 'uinteger';
	o.default = '10';
	o.depends('type', 'tuic');
	o.modalonly = true;
	/* Tuic config end */

	/* VMess / VLESS config start */
	o = s.option(form.ListValue, 'vless_flow', _('Flow'));
	o.value('', _('None'));
	o.value('xtls-rprx-vision');
	o.depends('type', 'vless');
	o.modalonly = true;

	o = s.option(form.Value, 'vmess_alterid', _('Alter ID'),
		_('Legacy protocol support (VMess MD5 Authentication) is provided for compatibility purposes only, use of alterId > 1 is not recommended.'));
	o.datatype = 'uinteger';
	o.depends('type', 'vmess');
	o.modalonly = true;

	o = s.option(form.ListValue, 'vmess_encrypt', _('Encrypt method'));
	o.value('auto');
	o.value('none');
	o.value('zero');
	o.value('aes-128-gcm');
	o.value('chacha20-poly1305');
	o.default = 'auto';
	o.depends('type', 'vmess');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Flag, 'vmess_global_padding', _('Global padding'),
		_('Protocol parameter. Will waste traffic randomly if enabled (enabled by default in v2ray and cannot be disabled).'));
	o.default = o.enabled;
	o.depends('type', 'vmess');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Flag, 'vmess_authenticated_length', _('Authenticated length'),
		_('Protocol parameter. Enable length block encryption.'));
	o.depends('type', 'vmess');
	o.modalonly = true;
	/* VMess config end */

	/* Transport config start */
	o = s.option(form.ListValue, 'transport', _('Transport'),
		_('No TCP transport, plain HTTP is merged into the HTTP transport.'));
	o.value('', _('None'));
	o.value('grpc', _('gRPC'));
	o.value('http', _('HTTP'));
	o.value('httpupgrade', _('HTTPUpgrade'));
	o.value('quic', _('QUIC'));
	o.value('ws', _('WebSocket'));
	o.depends('type', 'trojan');
	o.depends('type', 'vless');
	o.depends('type', 'vmess');
	o.onchange = function(ev, section_id, value) {
		let desc = this.map.findElement('id', 'cbid.homeproxy.%s.transport'.format(section_id)).nextElementSibling;
		if (value === 'http')
			desc.innerHTML = _('TLS is not enforced. If TLS is not configured, plain HTTP 1.1 is used.');
		else if (value === 'quic')
			desc.innerHTML = _('No additional encryption support: It\'s basically duplicate encryption.');
		else
			desc.innerHTML = _('No TCP transport, plain HTTP is merged into the HTTP transport.');

		let tls = this.map.findElement('id', 'cbid.homeproxy.%s.tls'.format(section_id)).firstElementChild;
		if ((value === 'http' && tls.checked) || (value === 'grpc' && !features.with_grpc)) {
			this.map.findElement('id', 'cbid.homeproxy.%s.http_idle_timeout'.format(section_id)).nextElementSibling.innerHTML =
				_('Specifies the period of time (in seconds) after which a health check will be performed using a ping frame if no frames have been received on the connection.<br/>' +
					'Please note that a ping response is considered a received frame, so if there is no other traffic on the connection, the health check will be executed every interval.');

			this.map.findElement('id', 'cbid.homeproxy.%s.http_ping_timeout'.format(section_id)).nextElementSibling.innerHTML =
				_('Specifies the timeout duration (in seconds) after sending a PING frame, within which a response must be received.<br/>' +
					'If a response to the PING frame is not received within the specified timeout duration, the connection will be closed.');
		} else if (value === 'grpc' && features.with_grpc) {
			this.map.findElement('id', 'cbid.homeproxy.%s.http_idle_timeout'.format(section_id)).nextElementSibling.innerHTML =
				_('If the transport doesn\'t see any activity after a duration of this time (in seconds), it pings the client to check if the connection is still active.');

			this.map.findElement('id', 'cbid.homeproxy.%s.http_ping_timeout'.format(section_id)).nextElementSibling.innerHTML =
				_('The timeout (in seconds) that after performing a keepalive check, the client will wait for activity. If no activity is detected, the connection will be closed.');
		}
	}
	o.modalonly = true;

	/* gRPC config start */
	o = s.option(form.Value, 'grpc_servicename', _('gRPC service name'));
	o.depends('transport', 'grpc');
	o.modalonly = true;

	if (features.with_grpc) {
		o = s.option(form.Flag, 'grpc_permit_without_stream', _('gRPC permit without stream'),
			_('If enabled, the client transport sends keepalive pings even with no active connections.'));
		o.depends('transport', 'grpc');
		o.modalonly = true;
	}
	/* gRPC config end */

	/* HTTP(Upgrade) config start */
	o = s.option(form.DynamicList, 'http_host', _('Host'));
	o.datatype = 'hostname';
	o.depends('transport', 'http');
	o.modalonly = true;

	o = s.option(form.Value, 'httpupgrade_host', _('Host'));
	o.datatype = 'hostname';
	o.depends('transport', 'httpupgrade');
	o.modalonly = true;

	o = s.option(form.Value, 'http_path', _('Path'));
	o.depends('transport', 'http');
	o.depends('transport', 'httpupgrade');
	o.modalonly = true;

	o = s.option(form.Value, 'http_method', _('Method'));
	o.value('GET', _('GET'));
	o.value('PUT', _('PUT'));
	o.depends('transport', 'http');
	o.modalonly = true;

	o = s.option(form.Value, 'http_idle_timeout', _('Idle timeout'),
		_('Specifies the period of time (in seconds) after which a health check will be performed using a ping frame if no frames have been received on the connection.<br/>' +
			'Please note that a ping response is considered a received frame, so if there is no other traffic on the connection, the health check will be executed every interval.'));
	o.datatype = 'uinteger';
	o.depends('transport', 'grpc');
	o.depends({'transport': 'http', 'tls': '1'});
	o.modalonly = true;

	o = s.option(form.Value, 'http_ping_timeout', _('Ping timeout'),
		_('Specifies the timeout duration (in seconds) after sending a PING frame, within which a response must be received.<br/>' +
			'If a response to the PING frame is not received within the specified timeout duration, the connection will be closed.'));
	o.datatype = 'uinteger';
	o.depends('transport', 'grpc');
	o.depends({'transport': 'http', 'tls': '1'});
	o.modalonly = true;
	/* HTTP config end */

	/* WebSocket config start */
	o = s.option(form.Value, 'ws_host', _('Host'));
	o.depends('transport', 'ws');
	o.modalonly = true;

	o = s.option(form.Value, 'ws_path', _('Path'));
	o.depends('transport', 'ws');
	o.modalonly = true;

	o = s.option(form.Value, 'websocket_early_data', _('Early data'),
		_('Allowed payload size is in the request.'));
	o.datatype = 'uinteger';
	o.value('2048');
	o.depends('transport', 'ws');
	o.modalonly = true;

	o = s.option(form.Value, 'websocket_early_data_header', _('Early data header name'));
	o.value('Sec-WebSocket-Protocol');
	o.depends('transport', 'ws');
	o.modalonly = true;
	/* WebSocket config end */

	o = s.option(form.ListValue, 'packet_encoding', _('Packet encoding'));
	o.value('', _('none'));
	o.value('packetaddr', _('packet addr (v2ray-core v5+)'));
	o.value('xudp', _('Xudp (Xray-core)'));
	o.depends('type', 'vless');
	o.depends('type', 'vmess');
	o.modalonly = true;
	/* Transport config end */

	/* Wireguard config start */
	o = s.option(form.DynamicList, 'wireguard_local_address', _('Local address'),
		_('List of IP (v4 or v6) addresses prefixes to be assigned to the interface.'));
	o.datatype = 'cidr';
	o.depends('type', 'wireguard');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'wireguard_private_key', _('Private key'),
		_('WireGuard requires base64-encoded private keys.'));
	o.password = true;
	o.depends('type', 'wireguard');
	o.validate = L.bind(hp.validateBase64Key, this, 44);
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'wireguard_peer_public_key', _('Peer pubkic key'),
		_('WireGuard peer public key.'));
	o.depends('type', 'wireguard');
	o.validate = L.bind(hp.validateBase64Key, this, 44);
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'wireguard_pre_shared_key', _('Pre-shared key'),
		_('WireGuard pre-shared key.'));
	o.password = true;
	o.depends('type', 'wireguard');
	o.validate = L.bind(hp.validateBase64Key, this, 44);
	o.modalonly = true;

	o = s.option(form.DynamicList, 'wireguard_reserved', _('Reserved field bytes'));
	o.datatype = 'integer';
	o.depends('type', 'wireguard');
	o.modalonly = true;

	o = s.option(form.Value, 'wireguard_mtu', _('MTU'));
	o.datatype = 'range(0,9000)';
	o.placeholder = '1408';
	o.depends('type', 'wireguard');
	o.modalonly = true;

	o = s.option(form.Value, 'wireguard_persistent_keepalive_interval', _('Persistent keepalive interval'),
		_('In seconds. Disabled by default.'));
	o.datatype = 'uinteger';
	o.depends('type', 'wireguard');
	o.modalonly = true;
	/* Wireguard config end */

	/* Mux config start */
	o = s.option(form.Flag, 'multiplex', _('Multiplex'));
	o.depends('type', 'shadowsocks');
	o.depends('type', 'trojan');
	o.depends('type', 'vless');
	o.depends('type', 'vmess');
	o.modalonly = true;

	o = s.option(form.ListValue, 'multiplex_protocol', _('Protocol'),
		_('Multiplex protocol.'));
	o.value('h2mux');
	o.value('smux');
	o.value('yamux');
	o.default = 'h2mux';
	o.depends('multiplex', '1');
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Value, 'multiplex_max_connections', _('Maximum connections'));
	o.datatype = 'uinteger';
	o.depends('multiplex', '1');
	o.modalonly = true;

	o = s.option(form.Value, 'multiplex_min_streams', _('Minimum streams'),
		_('Minimum multiplexed streams in a connection before opening a new connection.'));
	o.datatype = 'uinteger';
	o.depends('multiplex', '1');
	o.modalonly = true;

	o = s.option(form.Value, 'multiplex_max_streams', _('Maximum streams'),
		_('Maximum multiplexed streams in a connection before opening a new connection.<br/>' +
			'Conflict with <code>%s</code> and <code>%s</code>.').format(
				_('Maximum connections'), _('Minimum streams')));
	o.datatype = 'uinteger';
	o.depends({'multiplex': '1', 'multiplex_max_connections': '', 'multiplex_min_streams': ''});
	o.modalonly = true;

	o = s.option(form.Flag, 'multiplex_padding', _('Enable padding'));
	o.depends('multiplex', '1');
	o.modalonly = true;

	o = s.option(form.Flag, 'multiplex_brutal', _('Enable TCP Brutal'),
		_('Enable TCP Brutal congestion control algorithm'));
	o.depends('multiplex', '1');
	o.modalonly = true;

	o = s.option(form.Value, 'multiplex_brutal_down', _('Download bandwidth'),
		_('Download bandwidth in Mbps.'));
	o.datatype = 'uinteger';
	o.depends('multiplex_brutal', '1');
	o.modalonly = true;

	o = s.option(form.Value, 'multiplex_brutal_up', _('Upload bandwidth'),
		_('Upload bandwidth in Mbps.'));
	o.datatype = 'uinteger';
	o.depends('multiplex_brutal', '1');
	o.modalonly = true;
	/* Mux config end */

	/* TLS config start */
	o = s.option(form.Flag, 'tls', _('TLS'));
	o.depends('type', 'anytls');
	o.depends('type', 'http');
	o.depends('type', 'hysteria');
	o.depends('type', 'hysteria2');
	o.depends('type', 'shadowtls');
	o.depends('type', 'trojan');
	o.depends('type', 'tuic');
	o.depends('type', 'vless');
	o.depends('type', 'vmess');
	o.validate = function(section_id, _value) {
		if (section_id) {
			let type = this.map.lookupOption('type', section_id)[0].formvalue(section_id);
			let tls = this.map.findElement('id', 'cbid.homeproxy.%s.tls'.format(section_id)).firstElementChild;

			if (['anytls', 'hysteria', 'hysteria2', 'shadowtls', 'tuic'].includes(type)) {
				tls.checked = true;
				tls.disabled = true;
			} else {
				tls.disabled = null;
			}
		}

		return true;
	}
	o.modalonly = true;

	o = s.option(form.Value, 'tls_sni', _('TLS SNI'),
		_('Used to verify the hostname on the returned certificates unless insecure is given.'));
	o.depends('tls', '1');
	o.modalonly = true;

	o = s.option(form.DynamicList, 'tls_alpn', _('TLS ALPN'),
		_('List of supported application level protocols, in order of preference.'));
	o.depends('tls', '1');
	o.modalonly = true;

	o = s.option(form.Flag, 'tls_insecure', _('Allow insecure'),
		_('Allow insecure connection at TLS client.') +
		'<br/>' +
		_('This is <strong>DANGEROUS</strong>, your traffic is almost like <strong>PLAIN TEXT</strong>! Use at your own risk!'));
	o.depends('tls', '1');
	o.onchange = allowInsecureConfirm;
	o.modalonly = true;

	o = s.option(form.ListValue, 'tls_min_version', _('Minimum TLS version'),
		_('The minimum TLS version that is acceptable.'));
	o.value('', _('default'));
	for (let i of hp.tls_versions)
		o.value(i);
	o.depends('tls', '1');
	o.modalonly = true;

	o = s.option(form.ListValue, 'tls_max_version', _('Maximum TLS version'),
		_('The maximum TLS version that is acceptable.'));
	o.value('', _('default'));
	for (let i of hp.tls_versions)
		o.value(i);
	o.depends('tls', '1');
	o.modalonly = true;

	o = s.option(hp.CBIStaticList, 'tls_cipher_suites', _('Cipher suites'),
		_('The elliptic curves that will be used in an ECDHE handshake, in preference order. If empty, the default will be used.'));
	for (let i of hp.tls_cipher_suites)
		o.value(i);
	o.depends('tls', '1');
	o.optional = true;
	o.modalonly = true;

	o = s.option(form.Flag, 'tls_self_sign', _('Append self-signed certificate'),
		_('If you have the root certificate, use this option instead of allowing insecure.'));
	o.depends('tls_insecure', '0');
	o.modalonly = true;

	o = s.option(form.Value, 'tls_cert_path', _('Certificate path'),
		_('The path to the server certificate, in PEM format.'));
	o.value('/etc/homeproxy/certs/client_ca.pem');
	o.depends('tls_self_sign', '1');
	o.validate = hp.validateCertificatePath;
	o.rmempty = false;
	o.modalonly = true;

	o = s.option(form.Button, '_upload_cert', _('Upload certificate'),
		_('<strong>Save your configuration before uploading files!</strong>'));
	o.inputstyle = 'action';
	o.inputtitle = _('Upload...');
	o.depends({'tls_self_sign': '1', 'tls_cert_path': '/etc/homeproxy/certs/client_ca.pem'});
	o.onclick = L.bind(hp.uploadCertificate, this, _('certificate'), 'client_ca');
	o.modalonly = true;

	o = s.option(form.Flag, 'tls_ech', _('Enable ECH'),
		_('ECH (Encrypted Client Hello) is a TLS extension that allows a client to encrypt the first part of its ClientHello message.'));
	o.depends('tls', '1');
	o.modalonly = true;

	o = s.option(form.Value, 'tls_ech_config_path', _('ECH config path'),
		_('The path to the ECH config, in PEM format. If empty, load from DNS will be attempted.'));
	o.value('/etc/homeproxy/certs/client_ech_conf.pem');
	o.depends('tls_ech', '1');
	o.modalonly = true;

	o = s.option(form.Button, '_upload_ech_config', _('Upload ECH config'),
		_('<strong>Save your configuration before uploading files!</strong>'));
	o.inputstyle = 'action';
	o.inputtitle = _('Upload...');
	o.depends({'tls_ech': '1', 'tls_ech_config_path': '/etc/homeproxy/certs/client_ech_conf.pem'});
	o.onclick = L.bind(hp.uploadCertificate, this, _('ECH config'), 'client_ech_conf');
	o.modalonly = true;

	if (features.with_utls) {
		o = s.option(form.ListValue, 'tls_utls', _('uTLS fingerprint'),
			_('uTLS is a fork of "crypto/tls", which provides ClientHello fingerprinting resistance.'));
		o.value('', _('Disable'));
		o.value('360');
		o.value('android');
		o.value('chrome');
		o.value('edge');
		o.value('firefox');
		o.value('ios');
		o.value('qq');
		o.value('random');
		o.value('randomized');
		o.value('safari');
		o.depends({'tls': '1', 'type': /^((?!hysteria2?|tuic$).)+$/});
		o.validate = function(section_id, value) {
			if (section_id) {
				let tls_reality = this.map.findElement('id', 'cbid.homeproxy.%s.tls_reality'.format(section_id)).firstElementChild;
				if (tls_reality.checked && !value)
					return _('Expecting: %s').format(_('non-empty value'));

				let vless_flow = this.map.lookupOption('vless_flow', section_id)[0].formvalue(section_id);
				if ((tls_reality.checked || vless_flow) && ['360', 'android'].includes(value))
					return _('Unsupported fingerprint!');
			}

			return true;
		}
		o.modalonly = true;

		o = s.option(form.Flag, 'tls_reality', _('REALITY'));
		o.depends({'tls': '1', 'type': 'anytls'});
		o.depends({'tls': '1', 'type': 'vless'});
		o.modalonly = true;

		o = s.option(form.Value, 'tls_reality_public_key', _('REALITY public key'));
		o.password = true;
		o.depends('tls_reality', '1');
		o.rmempty = false;
		o.modalonly = true;

		o = s.option(form.Value, 'tls_reality_short_id', _('REALITY short ID'));
		o.password = true;
		o.depends('tls_reality', '1');
		o.modalonly = true;
	}
	/* TLS config end */

	/* Extra settings start */
	o = s.option(form.Flag, 'tcp_fast_open', _('TCP fast open'));
	o.modalonly = true;

	o = s.option(form.Flag, 'tcp_multi_path', _('MultiPath TCP'));
	o.modalonly = true;

	o = s.option(form.Flag, 'udp_fragment', _('UDP Fragment'),
		_('Enable UDP fragmentation.'));
	o.modalonly = true;

	o = s.option(form.Flag, 'udp_over_tcp', _('UDP over TCP'),
		_('Enable the SUoT protocol, requires server support. Conflict with multiplex.'));
	o.depends('type', 'socks');
	o.depends({'type': 'shadowsocks', 'multiplex': '0'});
	o.modalonly = true;

	o = s.option(form.ListValue, 'udp_over_tcp_version', _('SUoT version'));
	o.value('1', _('v1'));
	o.value('2', _('v2'));
	o.default = '2';
	o.depends('udp_over_tcp', '1');
	o.modalonly = true;
	/* Extra settings end */

	return s;
}

return view.extend({
	load() {
		return Promise.all([
			uci.load('homeproxy'),
			hp.getBuiltinFeatures()
		]);
	},

	render(data) {
		let m, s, o, ss, so;
		let main_node = uci.get(data[0], 'config', 'main_node');
		let routing_mode = uci.get(data[0], 'config', 'routing_mode');
		let features = data[1];

		/* Cache subscription information, it will be called multiple times */
		let subinfo = hp.loadSubscriptionInfo(data[0]);

		m = new form.Map('homeproxy', _('Edit nodes'));
		const mapSave = m.save;
		m.save = function(cb, silent) {
			return mapSave.call(this, function() {
				const removed = cleanupInactiveSubscriptionNodes(data[0]);
				if (removed > 0) {
					delete m.homeproxyNodeGroups;

					ui.addNotification(null, E('p', _('Removed %s node(s) from deleted subscriptions.').format(removed)));
				}

				if (typeof cb === 'function')
					return cb.apply(this, arguments);
			}, silent);
		}

		s = m.section(form.NamedSection, 'subscription', 'homeproxy');

		/* Node settings start */
		/* User nodes start */
		s.tab('node', _('Nodes'));
		o = s.taboption('node', form.SectionValue, '_node', CBIPagedGridSection, 'node');
		ss = renderNodeSettings(o.subsection, data, features, main_node, routing_mode, subinfo);
		ss.addremove = true;
		setupPagedNodeSection(ss, m, data[0], subinfo, (groups) => groups.user);
		/* Import subscription links start */
		/* Thanks to luci-app-shadowsocks-libev */
		ss.handleLinkImport = function() {
			let textarea = new ui.Textarea();
			ui.showModal(_('Import share links'), [
				E('p', _('Support Hysteria, Shadowsocks, Trojan, v2rayN (VMess), and XTLS (VLESS) online configuration delivery standard.')),
				textarea.render(),
				E('div', { class: 'right' }, [
					E('button', {
						class: 'btn',
						click: ui.hideModal
					}, [ _('Cancel') ]),
					'',
					E('button', {
						class: 'btn cbi-button-action',
						click: ui.createHandlerFn(this, () => {
							let input_links = textarea.getValue().trim().split('\n');
							if (input_links && input_links[0]) {
								/* Remove duplicate lines */
								input_links = input_links.reduce((pre, cur) =>
									(!pre.includes(cur) && pre.push(cur), pre), []);

								let allow_insecure = uci.get(data[0], 'subscription', 'allow_insecure');
								let packet_encoding = uci.get(data[0], 'subscription', 'packet_encoding');
								let imported_node = 0;
								input_links.forEach((l) => {
									let config = parseShareLink(l, features);
									if (config) {
										if (config.tls === '1' && allow_insecure === '1')
											config.tls_insecure = '1'
										if (['vless', 'vmess'].includes(config.type))
											config.packet_encoding = packet_encoding

										let nameHash = hp.calcStringMD5(config.label);
										let sid = uci.add(data[0], 'node', nameHash);
										Object.keys(config).forEach((k) => {
											uci.set(data[0], sid, k, config[k]);
										});
										imported_node++;
									}
								});

								if (imported_node === 0)
									ui.addNotification(null, E('p', _('No valid share link found.')));
								else
									ui.addNotification(null, E('p', _('Successfully imported %s nodes of total %s.').format(
										imported_node, input_links.length)));

								delete this.map.homeproxyNodeGroups;
								return uci.save()
									.then(L.bind(this.map.load, this.map))
									.then(L.bind(this.map.reset, this.map))
									.then(L.ui.hideModal)
									.catch(() => {});
							} else {
								return ui.hideModal();
							}
						})
					}, [ _('Import') ])
				])
			])
		}
		ss.renderSectionAdd = function(/* ... */) {
			let el = form.GridSection.prototype.renderSectionAdd.apply(this, arguments),
				nameEl = el.querySelector('.cbi-section-create-name');

			ui.addValidator(nameEl, 'uciname', true, (v) => {
				let button = el.querySelector('.cbi-section-create > .cbi-button-add');
				let uciconfig = this.uciconfig || this.map.config;

				if (!v) {
					button.disabled = true;
					return true;
				} else if (uci.get(uciconfig, v)) {
					button.disabled = true;
					return _('Expecting: %s').format(_('unique UCI identifier'));
				} else {
					button.disabled = null;
					return true;
				}
			}, 'blur', 'keyup');

			el.appendChild(E('button', {
				'class': 'cbi-button cbi-button-add',
				'title': _('Import share links'),
				'click': ui.createHandlerFn(this, 'handleLinkImport')
			}, [ _('Import share links') ]));

			return el;
		}
		/* Import subscription links end */
		/* User nodes end */

		/* Subscription nodes start */
		if (Object.keys(subinfo).length > 0) {
			s.tab('sub_node', _('Subscription nodes'));
			o = s.taboption('sub_node', form.SectionValue, '_sub_node', CBIPagedGridSection, 'node');
			ss = renderNodeSettings(o.subsection, data, features, main_node, routing_mode, subinfo);
			setupGroupedNodeSection(ss, m, data[0], subinfo);
		}
		/* Subscription nodes end */
		/* Node settings end */

		/* Subscriptions settings start */
		s.tab('subscription', _('Subscriptions'));

		o = s.taboption('subscription', form.Flag, 'auto_update', _('Auto update'),
			_('Auto update subscriptions and geodata.'));
		o.rmempty = false;

		o = s.taboption('subscription', form.ListValue, 'auto_update_time', _('Update time'));
		for (let i = 0; i < 24; i++)
			o.value(i, i + ':00');
		o.default = '2';
		o.depends('auto_update', '1');

		o = s.taboption('subscription', form.Flag, 'update_via_proxy', _('Update via proxy'),
			_('Update subscriptions via proxy.'));
		o.rmempty = false;

		o = s.taboption('subscription', form.DynamicList, 'subscription_url', _('Subscription URL-s'),
			_('Support Hysteria, Shadowsocks, Trojan, v2rayN (VMess), and XTLS (VLESS) online configuration delivery standard.'));
		o.validate = function(section_id, value) {
			if (section_id && value) {
				try {
					let url = new URL(value);
					if (!url.hostname)
						return _('Expecting: %s').format(_('valid URL'));
				}
				catch(e) {
					return _('Expecting: %s').format(_('valid URL'));
				}
			}

			return true;
		}

		o = s.taboption('subscription', form.ListValue, 'filter_nodes', _('Filter nodes'),
			_('Drop/keep specific nodes from subscriptions.'));
		o.value('disabled', _('Disable'));
		o.value('blacklist', _('Blacklist mode'));
		o.value('whitelist', _('Whitelist mode'));
		o.default = 'disabled';
		o.rmempty = false;

		o = s.taboption('subscription', form.DynamicList, 'filter_keywords', _('Filter keywords'),
			_('Drop/keep nodes that contain the specific keywords. <a target="_blank" href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions">Regex</a> is supported.'));
		o.depends({'filter_nodes': 'disabled', '!reverse': true});
		o.rmempty = false;

		o = s.taboption('subscription', form.Value, 'user_agent', _('User-Agent'));
		o.placeholder = 'Wget/1.21 (HomeProxy, like v2rayN)';

		o = s.taboption('subscription', form.Flag, 'allow_insecure', _('Allow insecure'),
			_('Allow insecure connection by default when add nodes from subscriptions.') +
			'<br/>' +
			_('This is <strong>DANGEROUS</strong>, your traffic is almost like <strong>PLAIN TEXT</strong>! Use at your own risk!'));
		o.rmempty = false;
		o.onchange = allowInsecureConfirm;

		o = s.taboption('subscription', form.ListValue, 'packet_encoding', _('Default packet encoding'));
		o.value('', _('none'));
		o.value('packetaddr', _('packet addr (v2ray-core v5+)'));
		o.value('xudp', _('Xudp (Xray-core)'));

		o = s.taboption('subscription', form.Button, '_save_subscriptions', _('Save subscriptions settings'),
			_('NOTE: Save current settings before updating subscriptions.'));
		o.inputstyle = 'apply';
		o.inputtitle = _('Save current settings');
		o.onclick = function() {
			return this.map.save(null, true).then(() => {
				ui.changes.apply(true);
			});
		}

		o = s.taboption('subscription', form.Button, '_update_subscriptions', _('Update nodes from subscriptions'));
		o.inputstyle = 'apply';
		o.inputtitle = function(section_id) {
			let sublist = uci.get(data[0], section_id, 'subscription_url') || [];
			if (sublist.length > 0) {
				return _('Update %s subscriptions').format(sublist.length);
			} else {
				this.readonly = true;
				return _('No subscription available')
			}
		}
		o.onclick = function() {
			return fs.exec_direct('/etc/homeproxy/scripts/update_subscriptions.uc').then((res) => {
				return location.reload();
			}).catch((err) => {
				ui.addNotification(null, E('p', _('An error occurred during updating subscriptions: %s').format(err)));
				return this.map.reset();
			});
		}

		o = s.taboption('subscription', form.Button, '_remove_subscriptions', _('Remove all nodes from subscriptions'));
		o.inputstyle = 'reset';
		o.inputtitle = function() {
			let subnodes = [];
			uci.sections(data[0], 'node', (res) => {
				if (res.grouphash)
					subnodes = subnodes.concat(res['.name'])
			});

			if (subnodes.length > 0) {
				return _('Remove %s nodes').format(subnodes.length);
			} else {
				this.readonly = true;
				return _('No subscription node');
			}
		}
		o.onclick = function() {
			let subnodes = [];
			uci.sections(data[0], 'node', (res) => {
				if (res.grouphash)
					subnodes = subnodes.concat(res['.name'])
			});

			for (let i in subnodes)
				uci.remove(data[0], subnodes[i]);

			removeNodeReferences(data[0], subnodes);

			delete this.map.homeproxyNodeGroups;
			this.inputtitle = _('%s nodes removed').format(subnodes.length);
			this.readonly = true;

			return this.map.save(null, true);
		}
		/* Subscriptions settings end */

		return m.render().then((node) => E([ E('style', [ css ]), node ]));
	}
});
