// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import starlight from '@astrojs/starlight';
import { sidebar } from './generated/sidebar.mjs';

// https://astro.build/config
export default defineConfig({
	site: 'shaid.github.io/nicodemus/',
	integrations: [
		starlight({
			title: 'Phantasie — Data Formats',
			favicon: '/favicon.png',
			description: 'A reverse-engineering field guide to the Phantasie RPG trilogy',
			sidebar,
		}),
		mdx(),
	],
});
