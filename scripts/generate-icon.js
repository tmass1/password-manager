const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const size = 1024;
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');

// Background gradient
const gradient = ctx.createLinearGradient(0, 0, size, size);
gradient.addColorStop(0, '#4f46e5');
gradient.addColorStop(1, '#7c3aed');

// Rounded rectangle background
ctx.fillStyle = gradient;
ctx.beginPath();
const radius = size * 0.2;
ctx.moveTo(radius, 0);
ctx.lineTo(size - radius, 0);
ctx.quadraticCurveTo(size, 0, size, radius);
ctx.lineTo(size, size - radius);
ctx.quadraticCurveTo(size, size, size - radius, size);
ctx.lineTo(radius, size);
ctx.quadraticCurveTo(0, size, 0, size - radius);
ctx.lineTo(0, radius);
ctx.quadraticCurveTo(0, 0, radius, 0);
ctx.closePath();
ctx.fill();

// Lock icon
ctx.fillStyle = '#ffffff';
ctx.strokeStyle = '#ffffff';
ctx.lineWidth = size * 0.04;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

const centerX = size / 2;
const centerY = size / 2;

// Lock body
const bodyWidth = size * 0.4;
const bodyHeight = size * 0.32;
const bodyX = centerX - bodyWidth / 2;
const bodyY = centerY - bodyHeight / 2 + size * 0.08;
const bodyRadius = size * 0.05;

ctx.beginPath();
ctx.moveTo(bodyX + bodyRadius, bodyY);
ctx.lineTo(bodyX + bodyWidth - bodyRadius, bodyY);
ctx.quadraticCurveTo(bodyX + bodyWidth, bodyY, bodyX + bodyWidth, bodyY + bodyRadius);
ctx.lineTo(bodyX + bodyWidth, bodyY + bodyHeight - bodyRadius);
ctx.quadraticCurveTo(bodyX + bodyWidth, bodyY + bodyHeight, bodyX + bodyWidth - bodyRadius, bodyY + bodyHeight);
ctx.lineTo(bodyX + bodyRadius, bodyY + bodyHeight);
ctx.quadraticCurveTo(bodyX, bodyY + bodyHeight, bodyX, bodyY + bodyHeight - bodyRadius);
ctx.lineTo(bodyX, bodyY + bodyRadius);
ctx.quadraticCurveTo(bodyX, bodyY, bodyX + bodyRadius, bodyY);
ctx.closePath();
ctx.fill();

// Lock shackle (the U-shaped part)
const shackleWidth = size * 0.24;
const shackleHeight = size * 0.2;
const shackleX = centerX - shackleWidth / 2;
const shackleY = bodyY - shackleHeight;

ctx.strokeStyle = '#ffffff';
ctx.lineWidth = size * 0.055;
ctx.beginPath();
ctx.moveTo(shackleX, bodyY);
ctx.lineTo(shackleX, shackleY + shackleWidth / 2);
ctx.arc(centerX, shackleY + shackleWidth / 2, shackleWidth / 2, Math.PI, 0, false);
ctx.lineTo(shackleX + shackleWidth, bodyY);
ctx.stroke();

// Keyhole
ctx.fillStyle = gradient;
const holeY = bodyY + bodyHeight * 0.35;
const holeRadius = size * 0.045;
ctx.beginPath();
ctx.arc(centerX, holeY, holeRadius, 0, Math.PI * 2);
ctx.fill();

// Keyhole slot
ctx.beginPath();
ctx.moveTo(centerX - size * 0.02, holeY + holeRadius * 0.5);
ctx.lineTo(centerX + size * 0.02, holeY + holeRadius * 0.5);
ctx.lineTo(centerX + size * 0.015, holeY + bodyHeight * 0.35);
ctx.lineTo(centerX - size * 0.015, holeY + bodyHeight * 0.35);
ctx.closePath();
ctx.fill();

// Save the icon
const buffer = canvas.toBuffer('image/png');
const outputPath = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(outputPath, buffer);
console.log('Icon saved to:', outputPath);
