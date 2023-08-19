const { dialog } = require('electron');

module.exports = class DialogHandler {
    constructor (context) {
        this.context = context;
    }

    promptUserForUnsavedChanges (event, message = null) {
        const choice = dialog.showMessageBoxSync(this.context, {
            type: 'question',
            buttons: ['Yes', 'No'],
            title: 'Confirm',
            message: message ?? 'You have unsaved changes, are you sure you want to quit?'
        });

        if (choice) {
            event.preventDefault();
        }
    }
};
