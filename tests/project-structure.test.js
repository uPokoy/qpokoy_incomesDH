'use strict';
const test=require('node:test');
const {checkProject}=require('./helpers/check-project');
test('all frontend JS, inline scripts, CSS and HTML structure pass checks',()=>checkProject());
