export async function refreshManagedOpenCodeIntegration(update, dependencies) {
    let projectRoot;
    let changeBudgetRoot;
    let discovery;
    try {
        projectRoot = dependencies.getProjectRoot();
        changeBudgetRoot = dependencies.getChangeBudgetRoot();
        discovery = await dependencies.discoverManagedIntegration(projectRoot, changeBudgetRoot);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dependencies.writeErr(`Warning: managed OpenCode integration discovery skipped: ${message}\n`);
        return 0;
    }
    switch (discovery.state) {
        case 'CONFLICT':
            dependencies.writeErr('Integration refresh skipped: conflict requires attention.\n');
            return 0;
        case 'ABSENT':
        case 'MANAGED_CURRENT':
            return 0;
        case 'MANAGED_STALE':
            break;
    }
    const progress = dependencies.createRefreshProgress();
    progress.start('opencode');
    try {
        if (update === undefined) {
            await dependencies.refreshCurrentIntegration({ projectRoot, changeBudgetRoot });
            progress.stop('opencode', 'success');
            return 0;
        }
        const refreshResult = dependencies.executeUpdatedCli === undefined
            ? await dependencies.runVerifiedNpmCli({ update, args: ['integrate', 'opencode'], cwd: projectRoot })
            : await dependencies.executeUpdatedCli({
                command: process.execPath,
                args: [update.entry, 'integrate', 'opencode'],
                cwd: projectRoot,
                shell: false,
            });
        if (refreshResult.kind === 'success') {
            progress.stop('opencode', 'success');
            return 0;
        }
        progress.stop('opencode', 'failure');
        const diagnostics = [refreshResult.errorMessage, refreshResult.stderr, refreshResult.stdout]
            .filter((value) => Boolean(value))
            .join('\n');
        dependencies.writeErr(`Package update completed, but managed OpenCode refresh failed${diagnostics.length > 0 ? `: ${diagnostics}` : ''}\n`);
        return 4;
    }
    catch (error) {
        progress.stop('opencode', 'failure');
        const message = error instanceof Error ? error.message : String(error);
        const scope = update === undefined ? 'Managed OpenCode refresh' : 'Package update completed, but managed OpenCode refresh';
        dependencies.writeErr(`${scope} failed: ${message}\n`);
        return 4;
    }
}
//# sourceMappingURL=update-refresh.js.map