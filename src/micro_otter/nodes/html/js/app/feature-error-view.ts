/**
 * Display a user-friendly error page when required features are missing.
 */

import { getFeatureDescription, getFeatureCompatibility } from '../core/feature-requirements.js';

interface FeatureDetail {
    available: boolean;
    reason?: string;
}

export class FeatureErrorView {
    /**
     * Show error page for missing features.
     * @param {string[]} missingFeatures Array of missing feature names
     * @param {Map<string, {available: boolean, reason?: string}>} details Feature details
     */
    static show(missingFeatures: string[], details: Map<string, FeatureDetail>): void {
        // Clear any existing content
        document.body.innerHTML = '';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.body.style.fontFamily = '"Segoe UI", Arial, sans-serif';
        document.body.style.backgroundColor = '#0e111b';
        document.body.style.color = '#e7ebff';

        const container = document.createElement('div');
        container.style.maxWidth = '800px';
        container.style.margin = '60px auto';
        container.style.padding = '40px';
        container.style.backgroundColor = 'rgba(12, 16, 28, 0.95)';
        container.style.borderRadius = '12px';
        container.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        container.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4)';

        // Header
        const header = document.createElement('div');
        header.style.marginBottom = '30px';

        const icon = document.createElement('div');
        icon.textContent = '⚠️';
        icon.style.fontSize = '48px';
        icon.style.marginBottom = '20px';
        header.appendChild(icon);

        const title = document.createElement('h1');
        title.textContent = 'Browser Compatibility Issue';
        title.style.margin = '0 0 12px 0';
        title.style.fontSize = '28px';
        title.style.fontWeight = '600';
        header.appendChild(title);

        const subtitle = document.createElement('p');
        subtitle.textContent = 'Your browser is missing some features required to run Micro-Otter.';
        subtitle.style.margin = '0';
        subtitle.style.fontSize = '16px';
        subtitle.style.color = 'rgba(231, 235, 255, 0.7)';
        header.appendChild(subtitle);

        container.appendChild(header);

        // Missing features list
        const featuresSection = document.createElement('div');
        featuresSection.style.marginBottom = '30px';

        const featuresTitle = document.createElement('h2');
        featuresTitle.textContent = 'Missing Features:';
        featuresTitle.style.fontSize = '18px';
        featuresTitle.style.fontWeight = '600';
        featuresTitle.style.marginBottom = '16px';
        featuresSection.appendChild(featuresTitle);

        const featuresList = document.createElement('div');
        featuresList.style.display = 'flex';
        featuresList.style.flexDirection = 'column';
        featuresList.style.gap = '12px';

        for (const featureName of missingFeatures) {
            const detail = details.get(featureName);
            const item = document.createElement('div');
            item.style.padding = '16px';
            item.style.backgroundColor = 'rgba(220, 38, 38, 0.1)';
            item.style.border = '1px solid rgba(220, 38, 38, 0.3)';
            item.style.borderRadius = '6px';

            const name = document.createElement('div');
            name.textContent = `✗ ${featureName}`;
            name.style.fontWeight = '600';
            name.style.marginBottom = '8px';
            name.style.color = '#fca5a5';
            item.appendChild(name);

            const description = document.createElement('div');
            description.textContent = getFeatureDescription(featureName);
            description.style.fontSize = '14px';
            description.style.marginBottom = '6px';
            description.style.color = 'rgba(231, 235, 255, 0.8)';
            item.appendChild(description);

            if (detail?.reason) {
                const reason = document.createElement('div');
                reason.textContent = `Reason: ${detail.reason}`;
                reason.style.fontSize = '13px';
                reason.style.color = 'rgba(231, 235, 255, 0.6)';
                reason.style.fontStyle = 'italic';
                item.appendChild(reason);
            }

            const compat = document.createElement('div');
            compat.textContent = `Supported in: ${getFeatureCompatibility(featureName)}`;
            compat.style.fontSize = '12px';
            compat.style.marginTop = '8px';
            compat.style.color = 'rgba(231, 235, 255, 0.5)';
            item.appendChild(compat);

            featuresList.appendChild(item);
        }

        featuresSection.appendChild(featuresList);
        container.appendChild(featuresSection);

        // Recommendations
        const recommendations = document.createElement('div');
        recommendations.style.padding = '20px';
        recommendations.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
        recommendations.style.border = '1px solid rgba(59, 130, 246, 0.3)';
        recommendations.style.borderRadius = '6px';
        recommendations.style.marginBottom = '20px';

        const recTitle = document.createElement('h3');
        recTitle.textContent = 'Recommended Actions:';
        recTitle.style.fontSize = '16px';
        recTitle.style.fontWeight = '600';
        recTitle.style.marginBottom = '12px';
        recommendations.appendChild(recTitle);

        const recList = document.createElement('ul');
        recList.style.margin = '0';
        recList.style.paddingLeft = '20px';
        recList.style.fontSize = '14px';
        recList.style.lineHeight = '1.6';

        const recItems: string[] = [
            'Update your browser to the latest version',
            'Try using a modern browser like Chrome, Edge, or Firefox',
            'Check if browser features are disabled by extensions or policies',
            'Enable required features in browser settings if available',
        ];

        for (const text of recItems) {
            const li = document.createElement('li');
            li.textContent = text;
            li.style.marginBottom = '6px';
            recList.appendChild(li);
        }

        recommendations.appendChild(recList);
        container.appendChild(recommendations);

        // Footer
        const footer = document.createElement('div');
        footer.style.fontSize = '13px';
        footer.style.color = 'rgba(231, 235, 255, 0.5)';
        footer.style.textAlign = 'center';
        footer.style.marginTop = '30px';
        footer.textContent = 'Micro-Otter requires a modern web browser to function properly.';
        container.appendChild(footer);

        document.body.appendChild(container);
    }
}
