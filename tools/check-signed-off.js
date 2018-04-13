import Git from 'nodegit';
import path from 'path';

const signedOffTemplate = (name, email) => `IoT.js-Debug-DCO-1.0-Signed-off-by: ${name} ${email}`;

Git.Repository.open(path.resolve(__dirname, '../'))
  .then(repo => {
    return Promise.resolve()
      .then(() => repo.getCurrentBranch().then(ref => ref.name()))
      .then(branchName => repo.getBranchCommit(branchName));
  })
  .then(commit => {
    const hash = commit.id().tostrS();
    const authorName = commit.author().name();
    const authorEmail = commit.author().email();
    const actualSignedOff = commit.message().split('\n').filter(line => line !== '').pop();
    const expectedSignedOff = signedOffTemplate(authorName, authorEmail);

    if (actualSignedOff !== expectedSignedOff) {
      console.error(
        'Signed-off-by message is incorrect.' +
        `The following line should be at the end of the ${hash} commit's message: '${expectedSignedOff}'.`
      );

      process.exit(1);
    } else {
      console.info('Signed-off-by message is correct.');
      process.exit(0);
    }
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
