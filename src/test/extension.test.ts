import * as assert from 'assert';
import { Util } from '../util';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import TranscodeTaskManager, { MutableIterableQueue, TranscodeTask } from '../video/task-manager';
import { resolve } from 'path';
// import * as myExtension from '../../extension';

type TaskWork = () => void;

suite('Extension Test Suite', () => {
	
	// Capture reported progress in tests
	let progress = 0;
	Util.testing = true;
	Util.mockProgress = {
		report: (value: {
					message?: string;
					increment?: number;
				}): void => {
			progress += (value.increment || 0) / 100;
		}
	}
	
	let increasingTimer = 1;
	
	function task(name: string, expectedProgress: number, extraWork?: TaskWork): TranscodeTask {
		return {
			name,
			id: name,
			operation: 'transcode',
			work: async (cancelToken) => {
				console.log(`Starting task: ${name}`);
				// Simulate a long-running task
				await new Promise((resolve) => setTimeout(resolve, (increasingTimer++) * 100));
				assert.equal(Number(progress.toFixed(3)), Number(expectedProgress.toFixed(3)));
				
				if (extraWork) {
					extraWork();
				}
				
				console.log(`Completed task: ${name}`);
			}
		};
	}

	function tasks(tasks: [string, number, TaskWork?][]): TranscodeTask[] {
		return tasks.map(t => task(t[0], t[1], t[2]));
	}
	
	test('Test MutableIterableQueue', () => {
		const queue = new MutableIterableQueue<{ id: string }>();
		const item1 = { id: 'item1' };
		const item2 = { id: 'item2' };
		const item3 = { id: 'item3' };
		
		// Adding items and length
		queue.enqueue([item1, item2]);
		assert.equal(queue.length, 2);
		queue.enqueue(item3);
		assert.equal(queue.length, 3);
		
		// Collect all items into an array with a for loop
		const items: { id: string }[] = [];
		for (const item of queue) {
			items.push(item);
			// Check length after each addition
			assert.equal(queue.length, 3 - items.length);
		}
		
		// Check if items match the expected order
		assert.deepEqual(items, [item1, item2, item3]);
	});

	test('Test TranscodeTaskManager progress stuff', async () => {
		const taskManager = new TranscodeTaskManager();
		
		// Add another task after the first 2 tasks complete
		const injectAdditionalTask = () => {
			console.log('Adding 1 more task');
			taskManager.enqueue(task('task4.mov', 3/4));
		};

		// Start wtih 3 tasks
		console.log('Adding 3 tasks');
		taskManager.enqueue(tasks([
			['task1.mov', 0],
			['task2.mov', 1/3, injectAdditionalTask],
			['task3.mov', 2/4],
		]));

		assert.equal(taskManager.count, 3);
		assert.equal(taskManager.remaining, 3);
		assert.equal(progress, 0);

		let operation = taskManager.resumeWithProgress();
		
		// Should only be 2 tasks left now
		assert.equal(taskManager.count, 3);
		assert.equal(taskManager.remaining, 2);
		
		// Wait for the operation to complete
		await operation;
		
		assert.equal(progress, 1, "Reported progress should be 1 after all tasks complete");
		// Manually reset progress
		progress = 0;
		
		assert.equal(taskManager.count, 0, "Task count should be reset");
		assert.equal(taskManager.remaining, 0, "Task queue should be empty");
		
		// Start 3 more tasks
		taskManager.enqueue(tasks([
			['task4.mov', 0],
			['task5.mov', 1/3],
			['task6.mov', 2/3],
		]));
		
		assert.equal(taskManager.count, 3);
		assert.equal(taskManager.remaining, 3);
		
		await taskManager.resumeWithProgress();
	});
	
	test('Test TranscodeTaskManager duplicate task handling', () => {
		const taskManager = new TranscodeTaskManager();
		
		// Create tasks with the same IDs
		const task1 = task('duplicate.mov', 0);
		const task2 = task('unique.mov', 0);
		const task3 = task('duplicate.mov', 0); // Same ID as task1
		
		// Enqueue the first task and verify it was added
		const result1 = taskManager.enqueue(task1);
		assert.equal(result1.length, 0, "No tasks should be skipped on first enqueue");
		assert.equal(taskManager.count, 1, "Task count should be 1");
		assert.equal(taskManager.remaining, 1, "Task queue should have 1 item");
		
		// Enqueue the second task (unique ID) and verify it was added
		const result2 = taskManager.enqueue(task2);
		assert.equal(result2.length, 0, "No tasks should be skipped for unique ID");
		assert.equal(taskManager.count, 2, "Task count should be 2");
		assert.equal(taskManager.remaining, 2, "Task queue should have 2 items");
		
		// Attempt to enqueue the third task (duplicate ID) and verify it was skipped
		const result3 = taskManager.enqueue(task3);
		assert.equal(result3.length, 1, "One task should be skipped due to duplicate ID");
		assert.equal(result3[0].id, task3.id, "Skipped task should have the same ID as the duplicate");
		assert.equal(taskManager.count, 2, "Task count should remain 2");
		assert.equal(taskManager.remaining, 2, "Task queue should still have 2 items");
		
		// Try enqueuing multiple tasks with some duplicates
		const task4 = task('another.mov', 0);
		const task5 = task('unique.mov', 0); // Duplicate of task2
		const task6 = task('third.mov', 0);
		
		const result4 = taskManager.enqueue([task4, task5, task6]);
		assert.equal(result4.length, 1, "One task should be skipped in batch enqueue");
		assert.equal(result4[0].id, task5.id, "Skipped task should be the duplicate one");
		assert.equal(taskManager.count, 4, "Task count should be 4 (2 original + 2 new)");
		assert.equal(taskManager.remaining, 4, "Task queue should have 4 items");
	});
});
